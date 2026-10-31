import React from 'react';
import {AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';

const WIDTH = 1728;
const HEIGHT = WIDTH * 900 / 1420;
const scenes = [
  {from: 0, duration: 90, file: 'codex-replica-workbench.mp4', offset: 120, speed: 1, title: 'Your Codex workspace. Your code.', step: '01 / 06'},
  {from: 90, duration: 300, file: 'codex-replica-live.mp4', offset: 0, speed: 2, title: 'Follow the conversation as work happens', step: '02 / 06'},
  {from: 390, duration: 240, file: 'codex-replica-workbench.mp4', offset: 0, speed: 3, title: 'Review changes beside the conversation', step: '03 / 06'},
  {from: 630, duration: 90, file: 'codex-replica-workbench.mp4', offset: 780, speed: 3, title: 'Inspect full files and word-level changes', step: '04 / 06'},
  {from: 720, duration: 150, file: 'codex-replica-edit.mp4', offset: 0, speed: 3, title: 'Edit the source. Preview the result.', step: '05 / 06'},
  {from: 870, duration: 90, file: 'codex-replica-edit.mp4', offset: 690, speed: 3, title: 'Hide the workbench. Keep your tabs.', step: '06 / 06'},
] as const;

const CaptureScene: React.FC<{scene: typeof scenes[number]}> = ({scene}) => (
  <AbsoluteFill style={{background: '#0c0d0f', color: '#f3f4f6', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'}}>
    <div style={{position: 'absolute', left: 100, right: 100, top: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
      <div style={{fontSize: 25, fontWeight: 650, letterSpacing: '-0.03em'}}>codex-app <span style={{fontWeight: 400, color: '#92989f'}}>/ macOS</span></div>
      <div style={{fontSize: 27, fontWeight: 550, letterSpacing: '-0.02em'}}>{scene.title}</div>
    </div>
    <div style={{position: 'absolute', left: 96, top: 66, width: WIDTH, height: HEIGHT, overflow: 'hidden', borderRadius: 20, boxShadow: '0 20px 60px #0008', border: '1px solid #323438'}}>
      {/* Crop only the native capture shadow: 56 px left and 38 px top in
          the 1532 x 1012 source. The captured client is 1420 x 900. */}
      <OffthreadVideo
        src={staticFile(scene.file)} startFrom={scene.offset} playbackRate={scene.speed} muted
        style={{position: 'absolute', left: -WIDTH * 56 / 1420, top: -HEIGHT * 38 / 900, width: WIDTH * 1532 / 1420, height: HEIGHT * 1012 / 900}}
      />
    </div>
    <div style={{position: 'absolute', left: 100, right: 100, bottom: 12, display: 'flex', justifyContent: 'space-between', color: '#8f969f', fontSize: 18}}>
      <span>{scene.step} · Actual client capture · {scene.speed}× playback</span>
      <span>Fictional workspace · Deterministic responses</span>
    </div>
  </AbsoluteFill>
);

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: '#0c0d0f', color: '#f3f4f6', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', justifyContent: 'center', alignItems: 'center'}}>
      <div style={{opacity: interpolate(frame, [0, 10], [0, 1], {extrapolateRight: 'clamp'}), textAlign: 'center'}}>
        <div style={{fontSize: 34, color: '#9ea6b0', marginBottom: 28}}>A desktop client you can inspect and change</div>
        <div style={{fontSize: 124, fontWeight: 700, letterSpacing: '-0.075em'}}>codex-app</div>
        <div style={{fontSize: 38, marginTop: 30}}>Run locally. Read the source. Make it yours.</div>
        <div style={{fontSize: 31, color: '#96b6ff', marginTop: 64}}>github.com/keriae/codex-app</div>
      </div>
      <div style={{position: 'absolute', bottom: 66, fontSize: 23, color: '#818995'}}>Independent macOS learning project · Unaffiliated with OpenAI · Parity in progress</div>
    </AbsoluteFill>
  );
};

export const CodexReplicaPromo: React.FC = () => (
  <AbsoluteFill>
    {scenes.map(scene => <Sequence key={scene.from} from={scene.from} durationInFrames={scene.duration} premountFor={15}><CaptureScene scene={scene}/></Sequence>)}
    <Sequence from={960} durationInFrames={90}><Outro/></Sequence>
  </AbsoluteFill>
);
