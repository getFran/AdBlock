// Shared by build.mjs and src/cosmetic/runtime.js: the bucket a hostname's cosmetic rules live in.

export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// The last two labels of a hostname ("a.b.example.com" -> "example.com"). Rules for a domain are bucketed by
// the key of that domain, so one lookup per page finds every rule for the hostname and its parents.
export function bucketKey(hostname) {
  const labels = hostname.split('.');
  return labels.length < 2 ? null : labels.slice(-2).join('.');
}

export const bucketOf = (key, buckets) => fnv1a(key) % buckets;
