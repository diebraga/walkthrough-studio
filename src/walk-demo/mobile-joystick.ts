export interface MobileJoystickInput {
    forward: number;
    strafe: number;
    knobX: number;
    knobY: number;
}

export function mobileJoystickInput(dx: number, dy: number, radius: number): MobileJoystickInput {
    const safeRadius = Math.max(1, radius);
    const length = Math.hypot(dx, dy);
    const scale = length > safeRadius ? safeRadius / length : 1;
    const knobX = dx * scale;
    const knobY = dy * scale;
    return {
        forward: knobY === 0 ? 0 : -knobY / safeRadius,
        strafe: knobX === 0 ? 0 : knobX / safeRadius,
        knobX,
        knobY,
    };
}
