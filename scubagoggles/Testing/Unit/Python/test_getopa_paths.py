"""Regression tests for OPA executable paths used by the download smoke check."""

import logging
import os
import stat
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from scubagoggles import getopa


PATHS = ('opa', 'OPA Tools/opa', 'tools [test]/opa', "O'Brien/opa", '-opa')


@pytest.mark.parametrize('filename', PATHS)
def test_version_check_passes_one_absolute_executable_argument(tmp_path, monkeypatch, filename):
    """Preserve the path literally and avoid looking up relative basenames in PATH."""
    monkeypatch.chdir(tmp_path)
    executable = Path(filename)
    result = SimpleNamespace(returncode=0, stdout=b'OPA version\n', stderr=b'')
    with patch.object(getopa.subprocess, 'run', return_value=result) as run:
        getopa.test_opa(executable)
    run.assert_called_once_with(
        [str(executable.resolve()), 'version'], capture_output=True, check=False
    )


@pytest.mark.skipif(os.name == 'nt', reason='Executable script fixture uses POSIX shebangs')
@pytest.mark.parametrize('filename', PATHS)
def test_version_check_executes_relative_paths(tmp_path, monkeypatch, caplog, filename):
    """Run a real local fixture without a shell, an OPA download, or PATH lookup."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('PATH', '')
    executable = Path(filename)
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_text(
        f'#!{sys.executable}\nimport sys\nprint("OPA fixture", sys.argv[1])\n',
        encoding='utf-8'
    )
    executable.chmod(executable.stat().st_mode | stat.S_IXUSR)
    with caplog.at_level(logging.DEBUG, logger=getopa.__name__):
        getopa.test_opa(executable)
    assert 'OPA fixture version' in caplog.text
    assert not any(record.levelno >= logging.ERROR for record in caplog.records)


def test_version_check_preserves_nonzero_exit_logging(tmp_path, caplog):
    """Keep the existing error-reporting behavior for executables that return errors."""
    result = SimpleNamespace(returncode=2, stdout=b'', stderr=b'fixture failed\n')
    with patch.object(getopa.subprocess, 'run', return_value=result):
        with caplog.at_level(logging.DEBUG, logger=getopa.__name__):
            getopa.test_opa(tmp_path / 'OPA Tools' / 'opa')
    assert 'results in error: 2' in caplog.text
    assert 'fixture failed' in caplog.text


def test_version_check_does_not_hide_missing_executable(tmp_path):
    """A missing executable must continue to raise a process-launch error."""
    with pytest.raises(FileNotFoundError):
        getopa.test_opa(tmp_path / 'missing-opa')
