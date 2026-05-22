const fs = require('fs');
const html = fs.readFileSync('NSYSU ITRC - 活動紀錄.html', 'utf8');

// The file might contain headings or paragraphs.
// Let's strip out tags and look at the structure.
const text = html.replace(/<[^>]+>/g, '\n').replace(/\n\s*\n/g, '\n');
fs.writeFileSync('parsed_text.txt', text);
