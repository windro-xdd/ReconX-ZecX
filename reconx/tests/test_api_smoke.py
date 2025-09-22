def test_placeholder_api_import():
    import reconx.api.main as m
    assert hasattr(m, 'app')