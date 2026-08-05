const MAX_PITCH = Math.PI / 2 - 0.01;

export function clampPitch(pitch: number): number {
    return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
}

export function nextLookAngles(input: {
    yaw: number;
    pitch: number;
    dx: number;
    dy: number;
    thirdPerson: boolean;
    sensitivity?: number;
}) {
    const sensitivity = input.sensitivity ?? 0.002;
    return {
        yaw: input.yaw - input.dx * sensitivity,
        pitch: clampPitch(input.pitch + (input.thirdPerson ? 1 : -1) * input.dy * sensitivity),
    };
}
