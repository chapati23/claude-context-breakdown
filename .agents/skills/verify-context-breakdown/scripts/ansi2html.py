# Turn a tmux capture (`capture-pane -p -e`) into an HTML page that keeps the
# colours. Usage: python3 ansi2html.py <in.ansi> <out.html> "<title>"
# It drops the lines above the last turn line (a line with ✻ or ⏺) when one exists.
import sys, re, html
src, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(src, encoding='utf-8').read().split('\n')
plain = [re.sub(r'\x1b\[[0-9;:]*m', '', l) for l in lines]
start = max([i for i, l in enumerate(plain) if '✻' in l or l.startswith('⏺')] or [0])
lines = lines[start:]
while lines and not re.sub(r'\x1b\[[0-9;:]*m', '', lines[-1]).strip(): lines.pop()
B = ['#000000','#cd3131','#0dbc79','#e5e510','#2472c8','#bc3fbc','#11a8cd','#e5e5e5']
BR = ['#666666','#f14c4c','#23d18b','#f5f543','#3b8eea','#d670d6','#29b8db','#ffffff']
def c256(n):
    n = int(n)
    if n < 8: return B[n]
    if n < 16: return BR[n-8]
    if n < 232:
        n -= 16; v = [0,95,135,175,215,255]
        return '#%02x%02x%02x' % (v[n//36], v[(n//6)%6], v[n%6])
    g = 8 + (n-232)*10; return '#%02x%02x%02x' % (g,g,g)
def conv(line):
    st = {}; res = []
    for part in re.split(r'(\x1b\[[0-9;:]*m)', line):
        m = re.fullmatch(r'\x1b\[([0-9;:]*)m', part)
        if m:
            ps = [p for p in re.split('[;:]', m.group(1))] or ['0']
            i = 0
            while i < len(ps):
                p = int(ps[i] or 0)
                if p == 0: st = {}
                elif p == 1: st['b'] = 1
                elif p == 2: st['d'] = 1
                elif p == 7: st['inv'] = 1
                elif p == 22: st.pop('b', None); st.pop('d', None)
                elif p == 27: st.pop('inv', None)
                elif 30 <= p <= 37: st['fg'] = B[p-30]
                elif 90 <= p <= 97: st['fg'] = BR[p-90]
                elif 40 <= p <= 47: st['bg'] = B[p-40]
                elif 100 <= p <= 107: st['bg'] = BR[p-100]
                elif p == 39: st.pop('fg', None)
                elif p == 49: st.pop('bg', None)
                elif p in (38, 48):
                    k = 'fg' if p == 38 else 'bg'
                    if ps[i+1] == '2': st[k] = '#%02x%02x%02x' % tuple(int(x) for x in ps[i+2:i+5]); i += 4
                    elif ps[i+1] == '5': st[k] = c256(ps[i+2]); i += 2
                i += 1
            continue
        if not part: continue
        fg, bg = st.get('fg', '#d4d4d4'), st.get('bg')
        if st.get('inv'): fg, bg = (bg or '#0c0c0c'), fg
        css = f'color:{fg};' + (f'background:{bg};' if bg else '') + ('font-weight:bold;' if st.get('b') else '') + ('opacity:.6;' if st.get('d') else '')
        res.append(f'<span style="{css}">{html.escape(part)}</span>')
    return ''.join(res)
body = '\n'.join(conv(l) for l in lines)
open(out, 'w', encoding='utf-8').write(f'''<!doctype html><meta charset="utf-8"><style>body{{margin:0;background:#0c0c0c}}h1{{font:600 14px -apple-system,sans-serif;color:#aaa;margin:10px 14px 0}}pre{{font:15px/1.25 Menlo,monospace;margin:8px 14px 14px;color:#d4d4d4}}</style><h1>{html.escape(title)}</h1><pre>{body}</pre>''')
