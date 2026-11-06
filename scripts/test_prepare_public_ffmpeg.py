import hashlib
import importlib.util
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('prepare_public_ffmpeg', Path(__file__).with_name('prepare-public-ffmpeg.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class PublicFfmpegTests(unittest.TestCase):
    def test_test_runner_does_not_write_import_cache(self):
        if os.environ.get('YUYU_TEST_FFMPEG_CHILD') == '1':
            return
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ['test_prepare_public_ffmpeg.py', 'prepare-public-ffmpeg.py']:
                shutil.copy2(Path(__file__).with_name(name), root/name)
            env = {**os.environ, 'YUYU_TEST_FFMPEG_CHILD': '1', 'PYTHONPYCACHEPREFIX': str(root/'cache')}
            env.pop('PYTHONDONTWRITEBYTECODE', None)
            subprocess.run([sys.executable, str(root/'test_prepare_public_ffmpeg.py')],
                           env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.assertEqual(list((root/'cache').rglob('prepare-public-ffmpeg.*.pyc')), [])

    def test_source_requires_exact_bytes_and_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root/'source.tar'
            path.write_bytes(b'synthetic source')
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            builder.verify_source(path, digest)
            with self.assertRaises(ValueError):
                builder.verify_source(path, '0'*64)
            link = root/'link'
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                builder.verify_source(link, digest)

    def test_archive_rejects_traversal_and_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name, kind in [('source/../../escape', tarfile.REGTYPE), ('source/link', tarfile.SYMTYPE)]:
                archive = root/'test.tar'
                with tarfile.open(archive, 'w') as tar:
                    info = tarfile.TarInfo(name)
                    info.type = kind
                    if kind == tarfile.SYMTYPE:
                        info.linkname = '/etc/passwd'
                        tar.addfile(info)
                    else:
                        info.size = 1
                        tar.addfile(info, io.BytesIO(b'x'))
                with self.assertRaises(ValueError):
                    builder.extract(archive, root, 'source')
                self.assertFalse((root/'escape').exists())

if __name__ == '__main__':
    unittest.main()
