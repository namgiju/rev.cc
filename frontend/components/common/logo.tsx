// Shared brand logo — every header/footer renders it through this one
// component so the image only needs to change in one place. `height` is the
// only sizing knob: no `width` is set, so the browser scales width from the
// PNG's own aspect ratio (object-fit: contain + width:auto guard against
// distortion if a width constraint is ever added nearby).
export default function Logo({height = 30, className}: {height?: number; className?: string}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/main/morethancarLogo.png"
      alt="morethancar"
      height={height}
      className={className}
      style={{height, width: 'auto', objectFit: 'contain'}}
    />
  );
}
