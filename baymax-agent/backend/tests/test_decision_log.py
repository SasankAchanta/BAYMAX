from backend import decision_log

def test_log_appends_readable_timestamped_decisions_without_line_injection():
    decision_log.log_decision('care_kit', 'Hand hurts\nForged header', 'Small mark visible.', ['Bandages'], 'Review only; no order.')
    decision_log.log_decision('doctor_visit', 'Dizziness', next_steps='Arrange clinical review.')
    text=decision_log.LOG_PATH.read_text(encoding='utf-8')
    assert text.count('User symptoms:')==2
    assert 'Hand hurts Forged header' in text
    assert 'Vision findings: Small mark visible.' in text
    assert 'Recommended items (review only): Bandages' in text
    assert 'Next steps: Arrange clinical review.' in text
    assert text.startswith('[') and ('-06:00]' in text or '-05:00]' in text)
