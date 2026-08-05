import { strict as assert } from "node:assert";
import { mobileJoystickInput } from "./mobile-joystick";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

assert.deepEqual(mobileJoystickInput(0, 0, 40), { forward: 0, strafe: 0, knobX: 0, knobY: 0 });

const forward = mobileJoystickInput(0, -20, 40);
near(forward.forward, 0.5);
near(forward.strafe, 0);
near(forward.knobY, -20);

const clamped = mobileJoystickInput(80, 0, 40);
near(clamped.strafe, 1);
near(clamped.knobX, 40);

const diagonal = mobileJoystickInput(40, -40, 40);
near(Math.hypot(diagonal.forward, diagonal.strafe), 1);
