export interface DeveloperPose {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
}

export function formatDeveloperPose(pose: DeveloperPose): string {
    const round = (n: number) => +n.toFixed(3);
    return JSON.stringify(
        {
            x: round(pose.x),
            y: round(pose.y),
            z: round(pose.z),
            yaw: round(pose.yaw),
            pitch: round(pose.pitch),
        },
        null,
        2,
    );
}
