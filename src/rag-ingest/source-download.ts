import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { BlockList, isIP } from "node:net";
import axios from "axios";

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const httpAgent = new HttpAgent({ keepAlive: false });
const httpsAgent = new HttpsAgent({ keepAlive: false });
const publicIpv6 = new BlockList();
publicIpv6.addSubnet("2000::", 3, "ipv6");

const nonPublic = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) {
  nonPublic.addSubnet(address, prefix);
}
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) {
  nonPublic.addSubnet(address, prefix, "ipv6");
}

function assertPublicAddress(address: string): void {
  const family = isIP(address);
  const allowed = family === 4
    ? !nonPublic.check(address)
    : family === 6 && publicIpv6.check(address, "ipv6") && !nonPublic.check(address, "ipv6");
  if (!allowed) throw new Error("Document source address is not public");
}

async function lookupPublicAddresses(hostname: string): Promise<[LookupAddress[]]> {
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length) throw new Error("Document source host has no DNS addresses");
  for (const { address } of addresses) assertPublicAddress(address);
  // Axios gives Node these checked addresses, with no separate DNS resolution
  // between validation and connect. The URL hostname remains the TLS identity.
  return [addresses];
}

type DownloadedSource = {
  bytes: Buffer;
  filename: string;
  contentType: string;
};

export async function downloadSource(sourceUrl: string): Promise<DownloadedSource> {
  let url = new URL(sourceUrl);
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);

  for (let redirects = 0; ; redirects++) {
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Document source must be an HTTP(S) URL without credentials");
    }

    // Node skips lookup for IP literals, so validate them before the request.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host)) assertPublicAddress(host);

    const response = await axios.get<Buffer>(url.href, {
      adapter: "http",
      responseType: "arraybuffer",
      proxy: false,
      maxRedirects: 0,
      maxContentLength: MAX_DOWNLOAD_BYTES,
      signal,
      httpAgent,
      httpsAgent,
      lookup: lookupPublicAddresses,
      validateStatus: () => true,
    });

    if (REDIRECTS.has(response.status)) {
      const location = response.headers.location;
      if (typeof location !== "string" || !location || redirects === MAX_REDIRECTS) {
        throw new Error("Document source redirect is missing a location or exceeds the redirect limit");
      }
      url = new URL(location, url);
      continue;
    }

    if (response.status !== 200) throw new Error(`Document source returned HTTP ${response.status}`);
    return asDocument(response.data, response.headers["content-type"], url);
  }
}

function asDocument(bytes: Buffer, contentType: unknown, url: URL): DownloadedSource {
  const name = url.pathname.split("/").pop() || "document";
  const format = typeof contentType === "string" ? contentType : "";
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return {
      bytes, contentType: "application/pdf",
      filename: name.replace(/\.pdf$/i, "") + ".pdf",
    };
  }

  const declaredHtml = /^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(format);
  const snippet = bytes.subarray(0, 1024).toString("utf8").trimStart();
  if (!declaredHtml && !/^(?:<!doctype\s+html\b|<html[\s>])/i.test(snippet)) {
    throw new Error("Document source did not return a PDF or HTML file");
  }
  return {
    bytes, contentType: declaredHtml ? format : "text/html",
    filename: name.replace(/\.x?html?$/i, "") + ".html",
  };
}
