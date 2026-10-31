import React from 'react';
import {Composition} from 'remotion';
import {CodexReplicaPromo} from './CodexReplicaPromo';

export const PromoRoot: React.FC = () => {
  return (
    <Composition
      id="CodexReplicaPromo"
      component={CodexReplicaPromo}
      durationInFrames={1050}
      fps={30}
      width={1920}
      height={1200}
    />
  );
};
