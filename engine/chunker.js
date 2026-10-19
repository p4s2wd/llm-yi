export function packSegments(segments, { maxChars = 1200, maxItems = 15 } = {}) {
  const batches = [];
  let current = [];
  let chars = 0;
  for (const s of segments) {
    if (current.length && (chars + s.text.length > maxChars || current.length >= maxItems)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(s);
    chars += s.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}
