import { cn } from '@/lib/utils';

// The routing wait thread (spec route-editing, «Вид ожидания прокладки»; design route-thread-loader): the trail of the
// site icon is drawn and erased from the tail in a loop. badge: an icon square in --primary (near the icon blue
// #3662a4) with a white thread, the pointer over the map moves it (RoutingBadgeOnMap); icon: a thread in the button
// color, the button sets the size, as for lucide icons. The stroke and the motion are the class route-thread in
// index.css (the curve measurement is there too); with prefers-reduced-motion the thread stays whole.

// The trail curve is a copy of d from web/public/favicon.svg: change one, change both. The ends lie outside the square
// 1024×1024, and the viewBox clips them, as the clip-path of the icon does
const TRAIL =
    'M-89.2 -258.6 C-86.1 -234.7 -78.8 -158.3 -70.9 -114.8 C-63.1 -71.3 -53.5 -32.2 -42.2 2.4 C-30.8 37.1 -17.7 67.3 -2.9 93.2 C11.9 119 28.5 140.4 46.8 157.4 C65.2 174.3 85.2 186.9 107.1 195 C128.9 203.2 154 203.9 177.8 206.2 C201.5 208.4 226.4 204.5 249.7 208.5 C272.9 212.6 301.9 216.1 317.1 230.4 C332.4 244.7 342.2 272.9 341.3 294.2 C340.4 315.6 325.4 339.6 311.9 358.7 C298.4 377.7 277.8 392.2 260.2 408.4 C242.6 424.7 221.8 438 206.3 455.9 C190.7 473.7 174.8 494 167.1 515.7 C159.5 537.3 155 564.4 160.3 585.9 C165.5 607.4 181.4 631.4 198.7 644.7 C216 658 242.1 664.7 264.2 665.5 C286.3 666.3 310.3 659.1 331.1 649.4 C351.8 639.7 371.5 623.4 388.7 607.1 C405.9 590.9 419.7 570.7 434.3 551.8 C448.9 532.8 461.3 511.9 476.4 493.4 C491.4 474.8 506.2 454.7 524.8 440.4 C543.4 426.1 565.7 412.6 588 407.3 C610.3 402 637.4 401.3 658.6 408.5 C679.9 415.6 702.1 432.1 715.5 450.2 C728.8 468.3 736.2 494.1 738.9 517.1 C741.5 540.1 736.5 565 731.4 588.1 C726.3 611.3 714.8 633.3 708.1 656.2 C701.4 679.1 689.3 703.4 691.1 725.6 C692.9 747.7 703.4 774 718.9 789.3 C734.4 804.6 761.5 811.5 784.1 817.3 C806.6 823 830.7 821.1 854.3 823.8 C877.8 826.4 904.8 826.7 925.3 832.9 C945.8 839.1 963.2 848.5 977.4 860.9 C991.6 873.4 1002.7 889 1010.6 907.8 C1018.5 926.6 1023.3 948.5 1024.8 973.5 C1026.4 998.5 1024.9 1026.7 1020.1 1058 C1015.4 1089.4 1000.4 1144.2 996.5 1161.4';

// the thread width in units of the square 1024 (the icon has 78): on a 16 px button it is ≈ 1.5 px, as the stroke of
// the lucide icons next to it; on the 27 px badge it is ≈ 2.5 px.
// The visible part of the stroke in index.css depends on it: change one, check the other
const STROKE_WIDTH = 96;

export function RouteThread({ variant, className }: { variant: 'badge' | 'icon'; className?: string }) {
    const thread = (
        <svg
            viewBox="0 0 1024 1024"
            aria-hidden="true"
            data-testid="route-thread"
            className={variant === 'badge' ? 'size-full' : className}
        >
            <path
                d={TRAIL}
                className="route-thread"
                fill="none"
                stroke={variant === 'badge' ? 'white' : 'currentColor'}
                strokeWidth={STROKE_WIDTH}
            />
        </svg>
    );
    if (variant === 'icon') {
        return thread;
    }
    // the square rounding is as in the icon: 174 of 1024
    return <span className={cn('block overflow-hidden rounded-[17%] bg-primary', className)}>{thread}</span>;
}
