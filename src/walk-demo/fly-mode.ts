export interface FlyInput {
    forward: number;
    strafe: number;
    vertical: number;
}

export interface FlyVector {
    x: number;
    y: number;
    z: number;
}

export function flyVector(input: FlyInput, yaw: number, pitch: number, speed: number): FlyVector {
    const cp = Math.cos(pitch);
    const forward = {
        x: -Math.sin(yaw) * cp,
        y: Math.sin(pitch),
        z: -Math.cos(yaw) * cp,
    };
    const right = {
        x: Math.cos(yaw),
        y: 0,
        z: -Math.sin(yaw),
    };
    const x = forward.x * input.forward + right.x * input.strafe;
    const y = forward.y * input.forward + input.vertical;
    const z = forward.z * input.forward + right.z * input.strafe;
    const len = Math.hypot(x, y, z);
    return len > 0 ? { x: (x / len) * speed, y: (y / len) * speed, z: (z / len) * speed } : { x: 0, y: 0, z: 0 };
}
