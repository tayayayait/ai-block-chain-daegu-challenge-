import os
import zipfile

EXCLUDE_DIRS = {
    'node_modules', '.git', '.docx_work', '.npm-cache', '.output',
    '.playwright-cli', '.playwright-mcp', '.tanstack', '.vercel',
    '.wrangler', 'test-results', 'tmp', '__pycache__', '.lovable'
}

EXCLUDE_FILES = {
    '.env', '.env.local', 'package_submission.py'
}

def should_exclude(rel_path):
    parts = rel_path.replace('\\', '/').split('/')
    for part in parts:
        if part in EXCLUDE_DIRS:
            return True
        if part.startswith('~$'):
            return True
    filename = parts[-1]
    if filename in EXCLUDE_FILES:
        return True
    if filename.endswith('.zip'):
        return True
    if filename.startswith('~$'):
        return True
    return False

def make_zip(source_dir, output_zip):
    print(f"Creating ZIP archive: {output_zip}")
    file_count = 0
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith('~$')]
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, source_dir)
                if should_exclude(rel_path):
                    continue
                zipf.write(full_path, rel_path)
                file_count += 1
    
    size_mb = os.path.getsize(output_zip) / (1024 * 1024)
    print(f"Successfully packaged {file_count} files into {output_zip} ({size_mb:.2f} MB)")

if __name__ == '__main__':
    source_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    output_zip = os.path.join(source_dir, '2026_대구_AI_블록체인_챌린지_프로토타입_온중.zip')
    make_zip(source_dir, output_zip)
