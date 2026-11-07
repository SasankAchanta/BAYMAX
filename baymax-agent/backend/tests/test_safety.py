import asyncio
from backend.state import SafetyState
from backend.voice import is_acknowledgement
from backend.vision import PoseHeuristic


def test_escalates_once():
    async def run():
        events, alerts = [], []
        async def emit(kind, data): events.append(kind)
        async def alert(reason): alerts.append(reason)
        state = SafetyState(emit, alert, .02)
        await state.anomaly("POSSIBLE_FALL")
        await state.anomaly("POSSIBLE_FALL")
        await asyncio.sleep(.06)
        assert state.state == "EMERGENCY"
        assert alerts == ["POSSIBLE_FALL"]
    asyncio.run(run())


def test_reset_cancels_escalation():
    async def run():
        async def emit(*args): pass
        async def alert(*args): raise AssertionError("Unexpected alert")
        state = SafetyState(emit, alert, .02)
        await state.anomaly("POSSIBLE_FALL")
        await state.reset()
        await asyncio.sleep(.05)
        assert state.state == "MONITORING"
    asyncio.run(run())


def test_acknowledgement_does_not_match_negation():
    assert is_acknowledgement("I'm okay")
    assert not is_acknowledgement("I'm not okay")
    assert not is_acknowledgement("I am okay but can't breathe")


def test_care_kit_never_orders():
    from backend.tools import Tools
    async def run():
        async def emit(*args): pass
        result = await Tools(emit, None).fetch_care_kit_items('cut', ['bandages', 'unknown'])
        assert result['order_executed'] is False
        assert len(result['items']) == 1
        assert result['items'][0]['order_executed'] is False
    asyncio.run(run())


def test_pose_requires_rapid_drop_and_horizontal_hold():
    detector = PoseHeuristic()
    def pts(hip):
        p = [[.5,.2,1.] for _ in range(17)]
        p[5][1] = p[6][1] = .35
        p[11][1] = p[12][1] = hip
        p[13][1] = p[14][1] = hip+.12
        p[15][1] = p[16][1] = hip+.25
        return p
    assert detector.update(0, [0,0,100,300], pts(.5)) == 'STANDING'
    assert detector.update(.5, [0,0,300,100], pts(.75)) is None
    assert detector.update(2.6, [0,0,300,100], pts(.75)) == 'POSSIBLE_FALL'
    detector.clear()
    assert detector.update(5, [0,0,300,100], pts(.75)) is None
    assert detector.update(8, [0,0,300,100], pts(.75)) is None
