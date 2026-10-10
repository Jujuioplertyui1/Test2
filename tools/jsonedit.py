"""Lock-safe edit of a shared JSON file (several people/agents editing the same file at once).
Takes an exclusive lock on <file>.lock, loads the JSON, runs your Python on it as `d`, writes it back (indent=1).
Usage:  python3 tools/jsonedit.py ORIGIN_RP/animations/origin.animation.json 'd["animations"]["animation.x"] = {...}'
        python3 tools/jsonedit.py <file> -f patch.py      (patch.py edits `d` in place)
Always use this for the shared resource-pack JSON (animations, animation controllers, render controllers,
item_texture.json, sound_definitions.json) instead of rewriting the file from a copy you loaded earlier."""
import fcntl, json, sys
path, code = sys.argv[1], sys.argv[2]
if code == "-f": code = open(sys.argv[3]).read()
with open(path + ".lock", "w") as lk:
    fcntl.flock(lk, fcntl.LOCK_EX)
    d = json.load(open(path, encoding="utf-8"))
    exec(code, {"d": d, "json": json})
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f: json.dump(d, f, indent=1, ensure_ascii=False)
    import os; os.replace(tmp, path)
print("ok", path)
