import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const colors = {
  background: '#09090a',
  border: 'rgba(255,255,255,0.12)',
  text: '#f7f7f7',
  secondary: '#c8c8c8',
  muted: '#777777',
  blue: '#62a8ff',
  purple: '#8e75ff',
  green: '#72c697',
};

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const liveCapture = staticFile('codex-replica-live.mp4');
const LIVE_DURATION = 330;
const PRECISION_DURATION = 54;
const OUTRO_DURATION = 66;

const workflowStages = [
  {label: 'INPUT', detail: 'Submit the prompt', accent: colors.blue},
  {label: 'INSPECT', detail: 'Read the interface', accent: colors.blue},
  {label: 'EDIT', detail: 'Tune the layout', accent: colors.purple},
  {label: 'VERIFY', detail: 'Run the check', accent: colors.purple},
  {label: 'MATCHED', detail: 'Workflow complete', accent: colors.green},
] as const;

const SceneBackground: React.FC<{children: React.ReactNode}> = ({children}) => (
  <AbsoluteFill
    style={{
      overflow: 'hidden',
      color: colors.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, sans-serif',
      background:
        'radial-gradient(circle at 50% 15%, rgba(98,168,255,0.10), transparent 34%), #09090a',
    }}
  >
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity: 0.19,
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
        backgroundSize: '64px 64px',
      }}
    />
    {children}
  </AbsoluteFill>
);

const AppMark: React.FC<{size?: number}> = ({size = 80}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.29,
      display: 'grid',
      placeItems: 'center',
      position: 'relative',
      background: '#171717',
      border: `1px solid ${colors.border}`,
      boxShadow: `0 0 ${size * 0.75}px rgba(89, 110, 255, 0.24)`,
    }}
  >
    <svg width={size * 0.72} height={size * 0.72} viewBox="0 0 100 100" fill="none">
      <path
        d="M50 13c10 0 14 8 19 13 8 0 18 1 23 10 5 10-1 18-5 24 1 8 1 18-7 24-8 7-17 4-24 2-7 5-15 9-24 4-10-5-10-15-10-23-6-6-12-13-8-23 4-11 14-13 22-14 4-8 7-17 14-17Z"
        stroke="url(#markGradient)"
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <path
        d="M34 44 45 52 34 60M52 61h15"
        stroke="white"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="markGradient" x1="19" y1="18" x2="84" y2="87" gradientUnits="userSpaceOnUse">
          <stop stopColor={colors.blue} />
          <stop offset="1" stopColor={colors.purple} />
        </linearGradient>
      </defs>
    </svg>
  </div>
);

const PhaseChip: React.FC<{
  active: boolean;
  complete: boolean;
  label: string;
  accent: string;
}> = ({active, complete, label, accent}) => (
  <div
    style={{
      height: 30,
      padding: '0 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      borderRadius: 999,
      border: `1px solid ${active ? accent : 'rgba(255,255,255,0.09)'}`,
      background: active ? `${accent}1a` : 'rgba(10,10,11,0.76)',
      color: active ? colors.text : complete ? '#9a9a9a' : '#5e5e5e',
      fontSize: 11,
      lineHeight: 1,
      fontWeight: 760,
      letterSpacing: '0.12em',
      boxShadow: active ? `0 0 22px ${accent}24` : undefined,
    }}
  >
    <span
      style={{
        width: 5,
        height: 5,
        borderRadius: 5,
        background: active ? accent : complete ? '#8a8a8a' : '#484848',
        boxShadow: active ? `0 0 9px ${accent}` : undefined,
      }}
    />
    {label}
  </div>
);

const LiveReplicaScene: React.FC = () => {
  const frame = useCurrentFrame();
  const activeStageIndex = frame < 42 ? 0 : frame < 123 ? 1 : frame < 210 ? 2 : frame < 278 ? 3 : 4;
  const activeStage = workflowStages[activeStageIndex];
  const labelOpacity = interpolate(frame, [0, 12], [0, 1], clamp);
  const endShade = interpolate(frame, [LIVE_DURATION - 10, LIVE_DURATION - 1], [0, 0.24], clamp);
  const progress = interpolate(frame, [0, LIVE_DURATION - 1], [0.01, 1], clamp);

  return (
    <SceneBackground>
      <div
        style={{
          position: 'absolute',
          left: 104,
          top: 18,
          right: 104,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 4,
          opacity: labelOpacity,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 8,
              background: colors.green,
              boxShadow: `0 0 13px ${colors.green}`,
            }}
          />
          <div
            style={{
              color: colors.green,
              fontSize: 14,
              lineHeight: 1,
              letterSpacing: '0.16em',
              fontWeight: 720,
              textTransform: 'uppercase',
            }}
          >
            Live · codex-app reconstruction
          </div>
        </div>
        <div style={{color: '#747474', fontSize: 12, letterSpacing: '0.11em'}}>
          DIRECT CAPTURE · EDITABLE UI · NO MOCKUP
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 96,
          top: 54,
          width: 1728,
          height: 972,
          overflow: 'hidden',
          borderRadius: 25,
          background: '#101010',
          border: `1px solid ${colors.border}`,
          boxShadow: `0 38px 92px rgba(0,0,0,0.56), 0 0 0 1px ${activeStage.accent}14`,
        }}
      >
        <OffthreadVideo
          src={liveCapture}
          muted
          style={{width: '100%', height: '100%', objectFit: 'contain'}}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: '#09090a',
            opacity: endShade,
          }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          zIndex: 5,
          left: 104,
          right: 104,
          bottom: 9,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
          {workflowStages.map((stage, index) => (
            <PhaseChip
              key={stage.label}
              active={index === activeStageIndex}
              complete={index < activeStageIndex}
              label={stage.label}
              accent={stage.accent}
            />
          ))}
        </div>
        <div
          style={{
            width: 392,
            display: 'flex',
            alignItems: 'center',
            gap: 13,
            padding: '0 13px',
            height: 30,
            borderRadius: 999,
            background: 'rgba(10,10,11,0.82)',
            border: '1px solid rgba(255,255,255,0.09)',
          }}
        >
          <div style={{fontSize: 10, color: '#777', letterSpacing: '0.12em', fontWeight: 720}}>
            {String(activeStageIndex + 1).padStart(2, '0')} / 05
          </div>
          <div style={{fontSize: 13, color: colors.secondary, whiteSpace: 'nowrap'}}>
            {activeStage.detail}
          </div>
          <div
            style={{
              flex: 1,
              height: 2,
              borderRadius: 2,
              background: 'rgba(255,255,255,0.08)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progress * 100}%`,
                height: '100%',
                borderRadius: 2,
                background: `linear-gradient(90deg, ${colors.blue}, ${colors.purple}, ${colors.green})`,
              }}
            />
          </div>
        </div>
      </div>
    </SceneBackground>
  );
};

const PrecisionWord: React.FC<{
  children: React.ReactNode;
  start: number;
  accent: string;
}> = ({children, start, accent}) => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [start, start + 10], [0, 1], clamp);

  return (
    <span
      style={{
        display: 'inline-block',
        color: accent,
        opacity: reveal,
        transform: `translateY(${(1 - reveal) * 18}px)`,
        textShadow: `0 0 34px ${accent}22`,
      }}
    >
      {children}
    </span>
  );
};

const PrecisionScene: React.FC = () => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, PRECISION_DURATION - 1], [0, 1], clamp);
  const shade = interpolate(frame, [0, 14], [0.18, 0.72], clamp);
  const eyebrow = interpolate(frame, [4, 14], [0, 1], clamp);
  const line = interpolate(frame, [22, 40], [0, 1], clamp);
  const supportingCopy = interpolate(frame, [28, 42], [0, 1], clamp);
  const contentExit = interpolate(frame, [44, PRECISION_DURATION - 1], [1, 0], clamp);

  return (
    <SceneBackground>
      <div
        style={{
          position: 'absolute',
          left: 96 * (1 - zoom),
          top: 54 * (1 - zoom),
          width: 1728 + 192 * zoom,
          height: 972 + 108 * zoom,
          overflow: 'hidden',
          borderRadius: 25 * (1 - zoom),
        }}
      >
        <OffthreadVideo
          src={liveCapture}
          muted
          startFrom={285}
          playbackRate={0.15}
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
      </div>
      <AbsoluteFill style={{background: `rgba(8,8,9,${shade})`, backdropFilter: 'blur(3px)'}} />
      <AbsoluteFill
        style={{justifyContent: 'center', alignItems: 'center', opacity: contentExit}}
      >
        <div
          style={{
            color: colors.green,
            fontSize: 15,
            lineHeight: 1,
            letterSpacing: '0.19em',
            fontWeight: 760,
            textTransform: 'uppercase',
            opacity: eyebrow,
          }}
        >
          Fidelity is the feature
        </div>
        <div
          style={{
            marginTop: 22,
            display: 'flex',
            gap: 24,
            fontSize: 82,
            lineHeight: 0.98,
            fontWeight: 770,
            letterSpacing: '-0.06em',
          }}
        >
          <PrecisionWord start={8} accent={colors.blue}>Measured.</PrecisionWord>
          <PrecisionWord start={14} accent={colors.purple}>Rebuilt.</PrecisionWord>
          <PrecisionWord start={20} accent={colors.green}>Matched.</PrecisionWord>
        </div>
        <div
          style={{
            marginTop: 28,
            height: 2,
            width: 720 * line,
            borderRadius: 4,
            background: `linear-gradient(90deg, ${colors.blue}, ${colors.purple}, ${colors.green})`,
            boxShadow: '0 0 24px rgba(98,168,255,0.28)',
          }}
        />
        <div
          style={{
            marginTop: 25,
            color: colors.secondary,
            fontSize: 22,
            letterSpacing: '-0.015em',
            opacity: supportingCopy,
          }}
        >
          The visual rhythm and the coding flow — rebuilt as an editable product.
        </div>
      </AbsoluteFill>
    </SceneBackground>
  );
};

const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame: frame + 5, fps, config: {damping: 18, stiffness: 110}});
  const button = interpolate(frame, [14, 30], [0, 1], clamp);
  const support = interpolate(frame, [24, 40], [0, 1], clamp);

  return (
    <SceneBackground>
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 26,
            opacity: enter,
            transform: `translateY(${(1 - enter) * 20}px)`,
          }}
        >
          <AppMark size={96} />
          <div>
            <div style={{fontSize: 64, fontWeight: 740, letterSpacing: '-0.055em'}}>codex-app</div>
            <div style={{fontSize: 23, color: colors.secondary, marginTop: 6}}>
              macOS desktop client reconstruction.
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 42,
            padding: '16px 31px',
            borderRadius: 999,
            color: '#101010',
            background: colors.text,
            fontSize: 19,
            fontWeight: 800,
            letterSpacing: '0.07em',
            opacity: button,
            transform: `scale(${0.95 + button * 0.05})`,
            boxShadow: '0 16px 54px rgba(255,255,255,0.13)',
          }}
        >
          EDITABLE · LOCAL · INSPECTABLE
        </div>
        <div
          style={{
            marginTop: 22,
            color: '#8c8c8c',
            fontSize: 15,
            letterSpacing: '0.025em',
            opacity: support,
          }}
        >
          Run it locally · Inspect every layer · Shape what comes next
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            color: colors.muted,
            fontSize: 11,
            letterSpacing: '0.09em',
          }}
        >
          INDEPENDENT LEARNING PROJECT · NOT AFFILIATED WITH OPENAI
        </div>
      </AbsoluteFill>
    </SceneBackground>
  );
};

export const CodexReplicaPromo: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: colors.background}}>
    <Sequence from={0} durationInFrames={LIVE_DURATION} premountFor={30}>
      <LiveReplicaScene />
    </Sequence>
    <Sequence from={LIVE_DURATION} durationInFrames={PRECISION_DURATION} premountFor={15}>
      <PrecisionScene />
    </Sequence>
    <Sequence
      from={LIVE_DURATION + PRECISION_DURATION}
      durationInFrames={OUTRO_DURATION}
      premountFor={15}
    >
      <OutroScene />
    </Sequence>
  </AbsoluteFill>
);
