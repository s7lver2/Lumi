import os
import fnmatch
import zipfile

def should_ignore(rel_path, ignore_patterns, is_dir=False):
    rel_path = rel_path.replace(os.sep, '/')
    for pattern in ignore_patterns:
        pattern = pattern.strip().replace(os.sep, '/')
        if not pattern or pattern.startswith('#'):
            continue
        
        pattern_is_dir = pattern.endswith('/')
        if pattern_is_dir and not is_dir:
            continue
        
        test_path = rel_path
        if pattern_is_dir:
            test_path += '/'
        
        if '/' in pattern:
            if pattern.startswith('/'):
                match_pattern = pattern.lstrip('/')
                if fnmatch.fnmatch(test_path, match_pattern):
                    return True
            else:
                if fnmatch.fnmatch(test_path, pattern) or fnmatch.fnmatch(test_path, '*/' + pattern):
                    return True
        else:
            if fnmatch.fnmatch(os.path.basename(test_path), pattern):
                return True
    return False

def zip_directory(dir_path='.', zip_path='archive.zip', additional_ignores=[]):
    gitignore_path = os.path.join(dir_path, '.gitignore')
    ignore_patterns = []
    if os.path.exists(gitignore_path):
        with open(gitignore_path, 'r') as f:
            ignore_patterns = [l.strip() for l in f if l.strip() and not l.startswith('#')]
    ignore_patterns += ['.git/'] + additional_ignores

    files_to_add = []
    for root, dirs, files in os.walk(dir_path):
        rel_root = os.path.relpath(root, dir_path)
        dirs[:] = [d for d in dirs if not should_ignore(
            os.path.join(rel_root, d).replace(os.sep, '/'), ignore_patterns, is_dir=True)]
        for file in files:
            abs_path = os.path.join(root, file)
            arcname = os.path.relpath(abs_path, dir_path).replace(os.sep, '/')
            if not should_ignore(arcname, ignore_patterns):
                files_to_add.append((abs_path, arcname))

    print(f"Found {len(files_to_add)} files to archive.")

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as zipf:
        for i, (abs_path, arcname) in enumerate(files_to_add):
            # Timestamp fijo → todos los bytes son ASCII válido → nunca se corrompe
            info = zipfile.ZipInfo(arcname, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(abs_path, 'rb') as f:
                zipf.writestr(info, f.read())
            print(f"Adding {arcname} ({i+1}/{len(files_to_add)})")

    # Verificar que el zip sea legible
    print("\nVerifying archive...")
    with zipfile.ZipFile(zip_path) as z:
        bad = []
        for name in z.namelist():
            try:
                with z.open(name) as f: f.read(16)
            except Exception as e:
                bad.append(f"  BAD: {name} — {e}")
        if bad:
            print(f"WARNING: {len(bad)} corrupted entries!")
            for b in bad: print(b)
        else:
            print(f"OK — {len(z.namelist())} files, all readable.")

if __name__ == '__main__':
    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _out  = os.path.join(_root, 'archive.zip')
    zip_directory(dir_path=_root, zip_path=_out, additional_ignores=[])