from fastapi.testclient import TestClient
from backend.main import app


def test_websocket_demo_flow():
    with TestClient(app) as client:
        health = client.get('/health')
        assert health.status_code == 200
        with client.websocket_connect('/ws', headers={'origin': 'http://localhost:5173'}) as ws:
            assert ws.receive_json()['type'] == 'snapshot'
            ws.send_json({'action': 'simulate_fall'})
            event = ws.receive_json()
            assert event['data']['state'] == 'CHECK_IN'
            assert ws.receive_json()['type'] == 'speech'
            ws.send_json({'action': 'chat', 'text': "I'm not okay"})
            assert ws.receive_json()['type'] == 'speech'
            assert client.get('/health').json()['state'] == 'CHECK_IN'
            ws.send_json({'action': 'acknowledge'})
            assert ws.receive_json()['data']['state'] == 'MONITORING'
            ws.send_json({'action': 'chat', 'text': 'I have a small cut'})
            kinds = []
            for _ in range(5):
                event = ws.receive_json()
                kinds.append(event['type'])
                if event['type'] == 'care_kit':
                    assert event['data']['order_executed'] is False
            assert 'care_kit' in kinds
            assert kinds[-1] == 'state'
