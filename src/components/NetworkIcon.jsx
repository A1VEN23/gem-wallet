export default function NetworkIcon({ network, size = 32 }) {
  if (!network) return null;
  return (
    <div
      className="net-icon"
      style={{
        width: size,
        height: size,
        background: network.color + '22',
        border: `2px solid ${network.color}55`,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.45,
        color: network.color,
        flexShrink: 0,
      }}
    >
      {network.icon}
    </div>
  );
}
