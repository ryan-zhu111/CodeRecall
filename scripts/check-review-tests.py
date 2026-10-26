import ast,contextlib,io,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
data=json.loads((ROOT/'public/problems.json').read_text(encoding='utf-8'))
suites=json.loads((ROOT/'public/review-tests.json').read_text(encoding='utf-8'))['problems']
def run(code,stdin):
    out,original=io.StringIO(),sys.stdin
    try:
        sys.stdin=io.StringIO(stdin)
        with contextlib.redirect_stdout(out):exec(code,{'__name__':'__main__'})
    finally:sys.stdin=original
    return out.getvalue().strip()
def norm(text,mode):
    lines=[' '.join(line.split()) for line in str(text).strip().splitlines() if line.strip()]
    if mode=='sort-lines':return sorted(lines)
    if mode=='sort-numbers':return sorted(map(float,str(text).split()))
    return lines
count=0
for p in data['problems']:
    ast.parse(p['referenceCode']);ast.parse(p['starterCode'])
    if p['track']!='leetcode':continue
    code=compile(data['prelude']+'\n\n'+p['referenceCode'],p['id'],'exec')
    assert len(suites[p['id']])>=2
    for case in suites[p['id']]:
        actual=run(code,case['input'])
        assert norm(actual,p['normalizer'])==norm(case['expected'],p['normalizer']),(p['id'],case,actual)
        count+=1
    template=compile(data['prelude']+'\n\n'+p['inputStarterCode'],p['id'],'exec')
    assert run(template,p['sampleInput'])==''
    assert any(norm(run(template,c['input']),p['normalizer'])!=norm(c['expected'],p['normalizer']) for c in suites[p['id']]),p['id']
algorithm_ids={p['id'] for p in data['problems'] if p['track']=='leetcode'}
assert set(suites)==algorithm_ids
print(f'PASS: all {len(algorithm_ids)} answers on {count} review tests; all input templates parse and cannot pass the full suite.')
