"""Configuration loading when the legacy defaults file is absent."""

from pathlib import Path

import pytest
import yaml

from scubagoggles.config import UserConfig


@pytest.fixture
def isolated_defaults(tmp_path, monkeypatch):
    """Keep migration, defaults and writes isolated from other tests."""
    legacy = tmp_path / '.scubagoggles'
    defaults = {'scubagoggles': {
        'opa_dir': '~/.scubagoggles', 'output_dir': './', 'credentials': None,
    }}
    monkeypatch.setattr(UserConfig, '_defaults', defaults)
    monkeypatch.setattr(UserConfig, '_main', defaults['scubagoggles'])
    monkeypatch.setattr(UserConfig, '_legacy_config_file', legacy)
    monkeypatch.setattr(UserConfig, '_default_config_file', legacy / 'userdefaults.yaml')
    return legacy


def write_config(path):
    """Create a complete configuration with synthetic local paths."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump({'scubagoggles': {
        'opa_dir': '/example/opa',
        'output_dir': '/example/reports',
        'credentials': None,
    }}), encoding='utf-8')


@pytest.mark.parametrize('path_kind', ['string', 'path', 'environment'])
def test_custom_config_without_legacy_file(tmp_path, monkeypatch, isolated_defaults, path_kind):
    """Existing custom configurations do not require a legacy defaults file."""
    custom = tmp_path / 'custom settings' / 'defaults.yaml'
    write_config(custom)
    original = custom.read_text(encoding='utf-8')
    argument = custom if path_kind == 'path' else str(custom)
    if path_kind == 'environment':
        monkeypatch.setenv('SCUBA_TEST_CONFIG', str(custom))
        argument = '$SCUBA_TEST_CONFIG'

    config = UserConfig(argument)

    assert config.file_exists
    assert config.config_path == custom
    assert config.output_dir == Path('/example/reports')
    assert config.opa_dir == Path('/example/opa')
    assert config.credentials_file is None
    assert custom.read_text(encoding='utf-8') == original
    assert not isolated_defaults.exists()


def test_missing_custom_config_keeps_defaults(tmp_path, isolated_defaults):
    """A nonexistent custom file still produces in-memory defaults."""
    custom = tmp_path / 'missing.yaml'
    config = UserConfig(custom)
    assert not config.file_exists
    assert config.output_dir == Path('.')
    assert not custom.exists()
    assert not isolated_defaults.exists()


def test_current_default_location_loads(isolated_defaults):
    """The current defaults directory must not be mistaken for a legacy file."""
    current = isolated_defaults / 'userdefaults.yaml'
    write_config(current)
    config = UserConfig()
    assert config.config_path == current
    assert config.output_dir == Path('/example/reports')


def test_legacy_file_still_migrates(isolated_defaults):
    """An actual legacy file retains its settings when migrated."""
    write_config(isolated_defaults)
    config = UserConfig()
    assert isolated_defaults.is_dir()
    assert config.config_path == isolated_defaults / 'userdefaults.yaml'
    assert config.file_exists
    assert config.output_dir == Path('/example/reports')


def test_custom_config_leaves_separate_legacy_file_untouched(tmp_path, isolated_defaults):
    """A different legacy file must not trigger migration of a custom file."""
    write_config(isolated_defaults)
    original = isolated_defaults.read_text(encoding='utf-8')
    custom = tmp_path / 'custom.yaml'
    write_config(custom)
    config = UserConfig(custom)
    assert config.config_path == custom
    assert isolated_defaults.read_text(encoding='utf-8') == original
