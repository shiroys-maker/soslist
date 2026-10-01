"""Read task choices at invocation time, including in the resident QTC server."""
import json
import os
from pathlib import Path

def choice(task, model, effort):
    file = Path(os.environ.get('SOSLIST_AI_SETTINGS_FILE', str(Path.home() / 'Library/Application Support/SOSList Local/ai-tasks.json')))
    try:
        saved = json.loads(file.read_text()).get(task, {})
    except FileNotFoundError:
        saved = {}
    return saved.get('model', model), saved.get('effort', effort)

def record(task, model, effort, state):
    import datetime
    file = Path(os.environ.get('SOSLIST_AI_SETTINGS_FILE', str(Path.home() / 'Library/Application Support/SOSList Local/ai-tasks.json')))
    try:
        directory = file.parent / 'AIExecutions'
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        target = directory / (task + '.json')
        temp = target.with_suffix('.' + str(os.getpid()) + '.tmp')
        temp.write_text(json.dumps(dict(model=model, effort=effort, state=state, pid=os.getpid(), at=datetime.datetime.now(datetime.timezone.utc).isoformat())))
        temp.chmod(0o600)
        temp.replace(target)
    except OSError:
        pass  # Diagnostic state must never prevent the task or slot release.
