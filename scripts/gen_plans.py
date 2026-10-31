# يولّد src/data/plans.json وكتلة بذور الخطط الدراسية في supabase/schema.sql من scripts/plans_data.py
# التشغيل: python3 scripts/gen_plans.py
import json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from plans_data import PLANS, EXPECTED

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for code, rows in PLANS.items():
    for (st, tm), units in EXPECTED[code].items():
        got = sum(r[8] for r in rows if r[0] == st and r[1] == tm)
        assert got == units, f'{code} {st}/{tm}: {got} != {units}'

with open(os.path.join(root, 'src/data/plans.json'), 'w', encoding='utf-8') as f:
    json.dump({k: [list(r) for r in v] for k, v in PLANS.items()}, f, ensure_ascii=False, indent=0)
    f.write('\n')

def q(s): return "'" + s.replace("'", "''") + "'"
blocks = []
for code, rows in PLANS.items():
    sort = {}
    vals = []
    for r in rows:
        k = (r[0], r[1]); sort[k] = sort.get(k, 0) + 1
        vals.append(f"  ({r[0]}, {r[1]}, {sort[k]}, {q(r[2])}, {q(r[3])}, {q(r[4])}, {q(r[5])}, {r[6]}, {r[7]}, {r[8]})")
    blocks.append(
        "insert into public.curriculum (department_id, stage, term, sort, name, name_en, category, language, theory_hours, practical_hours, units)\n"
        "select d.id, v.stage, v.term, v.sort, v.name, v.name_en, v.category, v.language, v.th, v.pr, v.units\n"
        "from public.departments d\ncross join (values\n" + ',\n'.join(vals) +
        "\n) as v(stage, term, sort, name, name_en, category, language, th, pr, units)\n"
        f"where d.code = '{code}'\non conflict (department_id, stage, term, name) do nothing;\n")
seed = ('-- <plans> (مولَّد تلقائياً من scripts/plans_data.py — لا تعدّله يدوياً)\n'
        '-- الخطط الدراسية الرسمية 2025-2026: التخدير، الأشعة والسونار، صناعة الأسنان، صحة المجتمع (المراحل الأربع)\n'
        + '\n'.join(blocks) + '-- </plans>')
p = os.path.join(root, 'supabase/schema.sql')
sql = open(p, encoding='utf-8').read()
if '-- <plans>' in sql:
    sql = re.sub(r'-- <plans>.*?-- </plans>', lambda m: seed, sql, flags=re.S)
else:
    sql = re.sub(r'-- الخطة الدراسية لقسم تقنيات صحة المجتمع.*?on conflict \(department_id, stage, term, name\) do nothing;', lambda m: seed, sql, flags=re.S)
open(p, 'w', encoding='utf-8').write(sql)
print('ok', {k: len(v) for k, v in PLANS.items()})
