"""Run the browser worker's actual AST checker against all multimodal answers/templates."""
import ast,json
from pathlib import Path
root=Path(__file__).resolve().parent.parent
worker=(root/'public/python-worker.js').read_text(encoding='utf-8')
source=worker.split('const result = pyodide.runPython(',1)[1].split('`',2)[1]
tree=ast.parse(source)
body=compile(ast.Module(body=tree.body[:-1],type_ignores=[]),'worker-structure','exec')
expression=compile(ast.Expression(tree.body[-1].value),'worker-result','eval')
def check(code,symbols):
    scope={'_source':code,'_required':symbols}
    exec(body,scope)
    result=json.loads(eval(expression,scope))
    return not result['missing'] and not result['placeholder']
data=json.loads((root/'public/problems.json').read_text(encoding='utf-8'))
problems=[p for p in data['problems'] if p['track']=='multimodal']
assert len(problems)==15
for p in problems:
    assert check(p['referenceCode'],p['requiredSymbols']),p['id']
    assert not check(p['starterCode'],p['requiredSymbols']),p['id']
assert not check('def unrelated():\n    return 1',['attention'])
assert not check('def attention():\n    ...',['attention'])
try:check('def attention(',['attention'])
except SyntaxError:pass
else:raise AssertionError('invalid syntax accepted')
print('PASS: 15 multimodal answers pass the browser AST checker; 15 blank templates, missing interfaces, placeholders and syntax errors are rejected. No numerical PyTorch execution claimed.')
