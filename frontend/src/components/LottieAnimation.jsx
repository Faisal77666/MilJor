import React, { useEffect, useRef } from 'react';
import lottie from 'lottie-web/build/player/lottie_light.js';

export const LottieAnimation = ({
  animationData,
  width = 300,
  height = 300,
  loop = false,
  autoplay = true,
}) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !animationData) return;

    const anim = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop,
      autoplay,
      animationData,
    });

    return () => {
      anim.destroy();
    };
  }, [animationData, loop, autoplay]);

  return (
    <div
      ref={containerRef}
      style={{ width: `${width}px`, height: `${height}px`, margin: '0 auto' }}
    />
  );
};

export default LottieAnimation;
