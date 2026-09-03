# NORTHWIND 5250 on a real X display.
#
# Xvfb + xterm + a curses application. No DOM, no accessibility API on the surface
# itself: an agent sees rendered glyphs and sends X events. The geometry is pinned so
# a pixel coordinate maps to a character cell deterministically — 10x20 bitmap font,
# zero border, 80x24 => exactly 800x480.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    BW_STATE_DIR=/var/lib/simapp

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb \
      xterm \
      xdotool \
      x11-utils \
      x11-xserver-utils \
      xfonts-base \
      imagemagick \
      python3 \
      procps \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ImageMagick's Debian policy blocks some coders; screenshots need none of the risky
# ones, but the policy also rejects the X11 delegate in some builds. Allow only what
# `import -window root png:-` needs.
RUN if [ -f /etc/ImageMagick-6/policy.xml ]; then \
      sed -i 's/rights="none" pattern="X11"/rights="read|write" pattern="X11"/' /etc/ImageMagick-6/policy.xml || true; \
    fi

COPY northwind5250.py /usr/local/bin/northwind5250.py
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY bw-fault /usr/local/bin/bw-fault
RUN chmod +x /usr/local/bin/northwind5250.py /usr/local/bin/entrypoint.sh /usr/local/bin/bw-fault

# Prove the application logic works before anything tries to drive it through X.
RUN BW_SELFTEST=1 python3 /usr/local/bin/northwind5250.py

RUN mkdir -p ${BW_STATE_DIR}

HEALTHCHECK --interval=2s --timeout=2s --retries=30 \
  CMD test -f /var/lib/simapp/state.json || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
