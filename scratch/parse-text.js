const fs = require('fs');
const path = require('path');

const contentPath = 'C:\\Users\\SHRAVAN B KOTAGI\\.gemini\\antigravity\\brain\\01575269-1156-4080-8acc-b3f29ac4b3cc\\.system_generated\\steps\\1486\\content.md';

if (!fs.existsSync(contentPath)) {
  console.error("Content file not found");
  process.exit(1);
}

const html = fs.readFileSync(contentPath, 'utf8');

// A very basic HTML text extractor
function stripHtml(html) {
  // Remove script and style tags and their contents
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Remove HTML tags
  clean = clean.replace(/<[^>]+>/g, ' ');
  // Decode basic entities
  clean = clean.replace(/&amp;/g, '&');
  clean = clean.replace(/&lt;/g, '<');
  clean = clean.replace(/&gt;/g, '>');
  clean = clean.replace(/&quot;/g, '"');
  clean = clean.replace(/&#38;/g, '&');
  clean = clean.replace(/&#038;/g, '&');
  clean = clean.replace(/\s+/g, ' ');
  return clean.trim();
}

const text = stripHtml(html);
console.log(text.substring(0, 4000));
