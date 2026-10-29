#!/usr/bin/env python3
"""Bundle the game into one self-contained HTML file: python3 build-single.py"""
import pathlib, re

root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text()
html = html.replace('<link rel="stylesheet" href="style.css">',
                    '<style>\n' + (root / 'style.css').read_text() + '</style>')
html = re.sub(r'<script src="([^"]+)"></script>',
              lambda m: '<script>\n' + (root / m.group(1)).read_text() + '\n</script>', html)
(root / 'rulebreak.html').write_text(html)
print('wrote rulebreak.html', len(html) // 1024, 'KB')
