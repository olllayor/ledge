import { Composition } from 'remotion';
import { LedgeReleaseDemo } from './LedgeReleaseDemo';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION_IN_FRAMES = 36 * FPS;

export const RemotionRoot = () => {
  return (
    <Composition
      id="LedgeReleaseDemo"
      component={LedgeReleaseDemo}
      durationInFrames={DURATION_IN_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
