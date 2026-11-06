#!/usr/bin/env python3
"""Build a source-pinned, non-GPL/non-nonfree macOS FFmpeg locally."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'ffmpeg-9.0.2.tar.xz': ('https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz', '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e'),
    'opus-1.5.2.tar.gz': ('https://downloads.xiph.org/releases/opus/opus-1.5.2.tar.gz', '65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1'),
}
FLAGS = ['--disable-autodetect', '--disable-gpl', '--disable-nonfree', '--disable-version3',
         '--disable-doc', '--disable-debug', '--disable-network', '--disable-ffplay',
         '--disable-ffprobe', '--disable-avdevice', '--disable-shared', '--enable-static',
         '--enable-small', '--enable-zlib', '--enable-libopus', '--pkg-config=pkg-config']

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def verify_source(path, expected):
    if path.is_symlink() or not path.is_file() or sha(path) != expected:
        raise ValueError('Source archive is missing or has an unexpected SHA-256')

def extract(archive, dest, directory):
    with tarfile.open(archive) as tar:
        for item in tar:
            name = Path(item.name)
            if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0] != directory or not (item.isfile() or item.isdir()):
                raise ValueError('Unsafe source archive entry')
        tar.extractall(dest)

def verify(output):
    record = json.loads((output/'build.json').read_text())
    if record.get('schemaVersion') != 1 or record.get('configure') != FLAGS:
        raise ValueError('Unexpected FFmpeg build record')
    for name, (_, digest) in SOURCES.items():
        verify_source(output/name, digest)
    for archive, member, license_name in [
        ('ffmpeg-9.0.2.tar.xz', 'ffmpeg-9.0.2/COPYING.LGPLv2.1', 'COPYING.LGPLv2.1'),
        ('ffmpeg-9.0.2.tar.xz', 'ffmpeg-9.0.2/LICENSE.md', 'FFMPEG-LICENSE.md'),
        ('ffmpeg-9.0.2.tar.xz', 'ffmpeg-9.0.2/README.md', 'FFMPEG-README.md'),
        ('opus-1.5.2.tar.gz', 'opus-1.5.2/COPYING', 'OPUS-COPYING')
    ]:
        with tarfile.open(output/archive) as tar:
            source = tar.extractfile(member)
            if source is None or (output/license_name).read_bytes() != source.read():
                raise ValueError('Source license text differs from the original archive')
    if (output/'build.py').read_bytes() != Path(__file__).read_bytes():
        raise ValueError('FFmpeg build recipe changed')
    binary = output/'ffmpeg'
    if binary.is_symlink() or not binary.is_file() or sha(binary) != record.get('binarySha256'):
        raise ValueError('FFmpeg binary differs from its build record')
    config = subprocess.check_output([str(binary), '-hide_banner', '-buildconf'], stderr=subprocess.STDOUT, text=True)
    for flag in ['--disable-gpl', '--disable-nonfree', '--disable-version3', '--enable-libopus']:
        if flag not in config:
            raise ValueError('FFmpeg build configuration is incomplete')
    if '--enable-gpl' in config or '--enable-nonfree' in config:
        raise ValueError('FFmpeg build contains disallowed components')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['build', 'verify'])
    parser.add_argument('--sources', type=Path, default=ROOT/'.tmp/public-ffmpeg-sources')
    parser.add_argument('--output', type=Path, default=ROOT/'.tmp/public-ffmpeg')
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve()
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise SystemExit('This source build is only configured for macOS arm64')
    if args.action == 'verify':
        verify(output)
        print('Public FFmpeg source and binary verified')
        return
    if output.exists():
        raise ValueError('FFmpeg output exists; choose a new directory')
    source_dir = args.sources.resolve()
    source_dir.mkdir(parents=True, exist_ok=True)
    for name, (url, digest) in SOURCES.items():
        archive = source_dir/name
        if not archive.exists() and args.download:
            with urllib.request.urlopen(url, timeout=60) as response, archive.open('xb') as file:
                shutil.copyfileobj(response, file)
        verify_source(archive, digest)
    with tempfile.TemporaryDirectory(prefix='yuyu-public-ffmpeg-') as temp:
        work = Path(temp)
        extract(source_dir/'ffmpeg-9.0.2.tar.xz', work, 'ffmpeg-9.0.2')
        extract(source_dir/'opus-1.5.2.tar.gz', work, 'opus-1.5.2')
        prefix = work/'opus-prefix'
        opus = work/'opus-1.5.2'
        subprocess.run(['./configure', f'--prefix={prefix}', '--disable-shared', '--enable-static',
                        '--disable-extra-programs', '--disable-doc'], cwd=opus, check=True)
        subprocess.run(['make', '-j4'], cwd=opus, check=True)
        subprocess.run(['make', 'install'], cwd=opus, check=True)
        # The only external pkg-config dependency is the verified local Opus build.
        tools = work/'bin'; tools.mkdir()
        pkg = tools/'pkg-config'
        pkg.write_text('#!/bin/sh\ncase "$1" in\n --version) echo 1.0 ;;\n --exists) [ "$3" = opus ] ;;\n'
                       f' --cflags) echo -I{prefix}/include/opus ;;\n'
                       f' --libs) echo -L{prefix}/lib -lopus -lm ;;\n'
                       f' --variable=includedir) echo {prefix}/include ;;\n *) exit 1 ;;\nesac\n')
        pkg.chmod(0o755)
        env = {**os.environ, 'PATH': str(tools)+os.pathsep+os.environ.get('PATH', '')}
        ffmpeg = work/'ffmpeg-9.0.2'
        subprocess.run(['./configure', *FLAGS], cwd=ffmpeg, env=env, check=True)
        subprocess.run(['make', '-j4', 'ffmpeg'], cwd=ffmpeg, env=env, check=True)
        staged = work/'result'; staged.mkdir()
        shutil.copy2(ffmpeg/'ffmpeg', staged/'ffmpeg')
        shutil.copy2(ffmpeg/'COPYING.LGPLv2.1', staged/'COPYING.LGPLv2.1')
        shutil.copy2(ffmpeg/'LICENSE.md', staged/'FFMPEG-LICENSE.md')
        shutil.copy2(ffmpeg/'README.md', staged/'FFMPEG-README.md')
        shutil.copy2(opus/'COPYING', staged/'OPUS-COPYING')
        shutil.copy2(Path(__file__), staged/'build.py')
        for name in SOURCES:
            shutil.copy2(source_dir/name, staged/name)
        (staged/'build.json').write_text(json.dumps({'schemaVersion': 1, 'configure': FLAGS,
            'binarySha256': sha(staged/'ffmpeg')}, indent=2)+'\n')
        verify(staged)
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(staged, output)
    print('Public FFmpeg built and verified; no release was uploaded')

if __name__ == '__main__':
    main()
