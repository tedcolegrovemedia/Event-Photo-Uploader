import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent } from 'node:https';
import tls from 'node:tls';
import type { StorageSettings } from '../types';
import type { StorageProvider, UploadOptions } from './index';

/**
 * Node only trusts its own bundled root list. Corporate Macs often run
 * security software that intercepts HTTPS and re-signs it with a private CA
 * that lives in the macOS Keychain — trusted by Safari, invisible to Node, and
 * the cause of "self signed certificate in certificate chain" on an otherwise
 * healthy machine. Merge the Keychain's trusted CAs into the list once.
 */
let cachedCAs: string[] | undefined | null = null;
function trustedCAs(): string[] | undefined {
  if (cachedCAs !== null) return cachedCAs;
  const get = (tls as unknown as { getCACertificates?: (type: string) => string[] })
    .getCACertificates;
  if (typeof get !== 'function') {
    cachedCAs = undefined;
    return cachedCAs;
  }
  try {
    const bundled = get.call(tls, 'default');
    const system = get.call(tls, 'system');
    cachedCAs = [...new Set([...bundled, ...system])];
  } catch {
    cachedCAs = undefined;
  }
  return cachedCAs;
}

function requestHandler(): NodeHttpHandler {
  return new NodeHttpHandler({
    httpsAgent: new Agent({ keepAlive: true, ca: trustedCAs() }),
  });
}

export class S3Storage implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private settings: StorageSettings;

  constructor(settings: StorageSettings) {
    if (!settings.bucket) throw new Error('No S3 bucket configured');
    if (!settings.region) throw new Error('No AWS region configured');

    this.settings = settings;
    this.bucket = settings.bucket;
    this.client = new S3Client({
      region: settings.region,
      // Set for S3-compatible providers (R2, B2, Wasabi, Spaces).
      ...(settings.endpoint
        ? { endpoint: settings.endpoint, forcePathStyle: true }
        : {}),
      requestHandler: requestHandler(),
      credentials: settings.accessKeyId
        ? {
            accessKeyId: settings.accessKeyId,
            secretAccessKey: settings.secretAccessKey,
          }
        : undefined, // fall back to the default AWS credential chain
      maxAttempts: 5,
    });
  }

  async upload(key: string, body: Buffer, opts: UploadOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        CacheControl: opts.cacheControl ?? 'public, max-age=31536000, immutable',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (status === 404 || status === 403) return false;
      throw err;
    }
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (status === 404 || status === 403) return null;
      throw err;
    }
  }

  getPublicUrl(key: string): string {
    const base = this.settings.publicAssetBaseUrl?.replace(/\/+$/, '');
    if (base) return `${base}/${key}`;
    if (this.settings.endpoint) {
      return `${this.settings.endpoint.replace(/\/+$/, '')}/${this.bucket}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.settings.region}.amazonaws.com/${key}`;
  }

  /**
   * Proves the credentials can do what the pipeline needs: write and delete
   * under the `g/` prefix. HeadBucket was the obvious choice but is denied by
   * the recommended least-privilege IAM policy (ListBucket is conditioned on a
   * prefix, and HeadBucket sends none), and its 403s carry no explanation.
   * PutObject errors, by contrast, come back with S3's own diagnosis.
   */
  async healthCheck(): Promise<void> {
    if (this.settings.accessKeyId && !this.settings.secretAccessKey) {
      throw new Error(
        'Secret access key is missing. Re-enter it in Settings and Save, then test again.',
      );
    }

    const key = `g/.healthcheck-${Date.now()}`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: Buffer.from('ok'),
          ContentType: 'text/plain',
        }),
      );
    } catch (err) {
      throw new Error(describeS3Error(err, this.bucket, this.settings.region));
    }

    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      throw new Error(
        `Uploads work, but deleting a test object failed: ${describeS3Error(err, this.bucket, this.settings.region)} Add s3:DeleteObject to the IAM policy.`,
      );
    }
  }
}

/** Turns SDK errors into something the operator can act on. */
function describeS3Error(err: unknown, bucket: string, region: string): string {
  const e = err as {
    name?: string;
    message?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
    $response?: { headers?: Record<string, string> };
  };
  const code = e?.Code ?? e?.name ?? '';
  const status = e?.$metadata?.httpStatusCode;
  const raw = e?.message && e.message !== 'UnknownError' ? e.message : code || 'Unknown error';

  switch (code) {
    case 'InvalidAccessKeyId':
      return 'The access key ID is not recognised by AWS. Check it for typos or create a new key.';
    case 'SignatureDoesNotMatch':
      return 'The secret access key is wrong (or was truncated on paste). Re-enter it.';
    case 'AccessDenied':
      return `Access denied writing to bucket "${bucket}". The IAM policy attached to this key must allow s3:PutObject on arn:aws:s3:::${bucket}/events/* and /g/*.`;
    case 'NoSuchBucket':
      return `Bucket "${bucket}" does not exist. Check the name for typos.`;
    case 'PermanentRedirect':
    case 'AuthorizationHeaderMalformed': {
      const actual = e?.$response?.headers?.['x-amz-bucket-region'];
      return actual
        ? `Bucket "${bucket}" is in ${actual}, not ${region}. Change the region in Settings.`
        : `Bucket "${bucket}" is in a different region than ${region}. ${raw}`;
    }
  }

  switch (status) {
    case 403:
      return `Access denied to bucket "${bucket}". The access key ID or secret is wrong, or the IAM policy does not name this bucket.`;
    case 404:
      return `Bucket "${bucket}" does not exist in ${region}. Check the name for typos.`;
    case 301:
      return `Bucket "${bucket}" is in a different region than ${region}.`;
  }

  if (/self[- ]signed certificate|SELF_SIGNED_CERT|UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF|CERT_UNTRUSTED/i.test(raw)) {
    const short = raw.replace(/;\s*if the root CA is installed locally.*$/i, '');
    return `HTTPS to S3 is being intercepted on this Mac, probably by security or filtering software (${short}). The app trusts certificates in the macOS Keychain; open Keychain Access and make sure the software's root certificate is installed and set to Always Trust, then try again.`;
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET/.test(raw)) {
    return `Could not reach S3 (${raw}). Check the internet connection.`;
  }
  return raw;
}
