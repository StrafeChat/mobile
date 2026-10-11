#!/usr/bin/env python3
"""Add a block of mobile.<group> strings to all six locale files.

Usage: add-strings.py <json file>  where the json is
  {"group": "media", "comment": "...", "strings": {"key": {"en": "...", "es": "...", ...}}}
Keys are inserted under mobile.<group> (created if missing, appended to if present).
"""
import json, sys, re
LANGS = ['en', 'es', 'pt-BR', 'fr', 'de', 'ar']
spec = json.load(open(sys.argv[1]))
group, strings = spec['group'], spec['strings']

def lit(v):
    return json.dumps(v, ensure_ascii=False)

for lang in LANGS:
    p = f'src/i18n/locales/{lang}.ts'
    s = open(p).read()
    lines = ''.join(f"      {k}: {lit(v[lang])},\n" for k, v in strings.items() if lang in v)
    m = re.search(rf"\n    {re.escape(group)}: \{{\n", s)
    if m:
        # append inside the existing group: find its closing "    },"
        start = m.end()
        end = s.index("\n    },", start)
        s = s[:end] + "\n" + lines.rstrip('\n') + s[end:]
    else:
        block = (f"\n    // {spec.get('comment', group)}\n" if spec.get('comment') else "\n") + f"    {group}: {{\n{lines}    }},\n"
        idx = s.rstrip().rfind('},')  # closes `mobile`
        s = s[:idx].rstrip() + "\n" + block + "  " + s[idx:]
    open(p, 'w').write(s)
print('ok', group, len(strings))
