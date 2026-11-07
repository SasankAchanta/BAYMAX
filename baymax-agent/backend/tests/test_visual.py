import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from pydantic import ValidationError
from backend.agent import ProactiveVision, VisualObservation, proactive_vision_enabled
from backend.vision import PoseHeuristic


def observation(action="coughing", confidence=75):
    return dict(action=action, confidence=confidence, is_dangerous=False, summary="Possible visible observation")


@pytest.mark.parametrize("patch", [{"confidence": 101}, {"confidence": -1}, {"confidence": True}, {"confidence": "90"}, {"is_dangerous": "false"}, {"action": "diagnosis"}, {"summary": ""}])
def test_rejects_invalid_observations(patch):
    with pytest.raises(ValidationError):
        VisualObservation.model_validate({**observation(), **patch})


def test_json_request_and_validation(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "test")
    monkeypatch.setenv("NVIDIA_VISION_MODEL", "test-model")
    async def run():
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(observation())))])
        create = AsyncMock(return_value=response)
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)), close=AsyncMock())
        monitor = ProactiveVision(None, None, None, client_factory=lambda **kw: client)
        result = await monitor.inspect("frame")
        assert result['confidence'] == 75
        args = client.chat.completions.create.call_args.kwargs
        assert args['response_format'] == {'type': 'json_object'}
        assert args['messages'][0]['content'][1]['image_url']['url'].endswith('frame')
        client.close.assert_awaited_once()
    asyncio.run(run())


@pytest.mark.parametrize('action,confidence,triggers', [('coughing',75,True),('visible_wound',92,True),('looking_sick',80,True),('coughing',74.9,False),('sneezing',99,False),('normal',100,False)])
def test_threshold_and_cooldown(action, confidence, triggers):
    async def run():
        callback, emit = AsyncMock(return_value=True), AsyncMock()
        monitor = ProactiveVision(SimpleNamespace(get_current_frame_base64=lambda: 'frame'), emit, callback)
        monitor.inspect = AsyncMock(return_value=observation(action, confidence))
        await monitor.tick()
        await monitor.tick()
        assert callback.await_count == int(triggers)
        assert emit.await_count == 2
    asyncio.run(run())


def test_no_camera_frame_skips_request():
    async def run():
        monitor = ProactiveVision(SimpleNamespace(get_current_frame_base64=lambda: None), AsyncMock(), AsyncMock())
        monitor.inspect = AsyncMock()
        await monitor.tick()
        monitor.inspect.assert_not_awaited()
    asyncio.run(run())


def test_enable_requires_camera_key_model_and_switch(monkeypatch):
    for key in ('ENABLE_CAMERA','NVIDIA_API_KEY','NVIDIA_VISION_MODEL','ENABLE_PROACTIVE_VISION'):
        monkeypatch.delenv(key, raising=False)
    assert not proactive_vision_enabled()
    monkeypatch.setenv('ENABLE_CAMERA','true')
    monkeypatch.setenv('NVIDIA_API_KEY','test')
    assert not proactive_vision_enabled()
    monkeypatch.setenv('NVIDIA_VISION_MODEL','test')
    assert proactive_vision_enabled()
    monkeypatch.setenv('ENABLE_PROACTIVE_VISION','false')
    assert not proactive_vision_enabled()


def test_proactive_checkin_populates_supplies_without_timer():
    from backend import main
    async def run():
        await main.safety.reset()
        try:
            assert await main.proactive_checkin(observation('visible_wound',92))
            assert main.safety.state == 'INTERACTIVE_CHECKUP'
            assert main.safety.deadline is None
            assert {i['id'] for i in main.tools.items} == {'bandages','saline'}
            assert all(i['order_executed'] is False for i in main.tools.items)
            assert not await main.proactive_checkin(observation())
            main.safety.state = 'CHECK_IN'
            assert not await main.proactive_checkin(observation())
        finally:
            await main.safety.reset()
    asyncio.run(run())


def test_pose_labels_and_confidence():
    p = [[.5,.2,.92] for _ in range(17)]
    p[5][1] = p[6][1] = .35
    p[11][1] = p[12][1] = .5
    p[13][1] = p[14][1] = .65
    p[15][1] = p[16][1] = .85
    d = PoseHeuristic()
    d.update(0,[0,0,100,300],p)
    assert d.classification == {'action':'STANDING','confidence':92,'available':True}
    p[13][0] = p[14][0] = .8
    d.update(1,[0,0,100,300],p)
    assert d.classification['action'] == 'SITTING'
    p[0][1] = .4
    for i in range(125):
        d.update(2+i*.1,[0,0,100,300],p)
    assert d.classification['action'] == 'SLUMPED_AT_DESK'
    p[5][2] = .1
    d.update(20,[0,0,100,300],p)
    assert not d.classification['available']
