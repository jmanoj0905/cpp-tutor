FROM ubuntu:14.04

# 14.04 is EOL — repoint apt at the archive so apt-get update works.
RUN sed -i 's|http://archive.ubuntu.com|http://old-releases.ubuntu.com|g; s|http://security.ubuntu.com|http://old-releases.ubuntu.com|g' /etc/apt/sources.list \
 && apt-get update && apt-get install -y \
    build-essential autotools-dev automake libc6-dbg python \
 && rm -rf /var/lib/apt/lists/*

COPY opt-cpp-backend /opt/tracer
WORKDIR /opt/tracer/valgrind-3.11.0
RUN ./autogen.sh && ./configure --prefix=`pwd`/inst && make && make install

RUN useradd netuser && find /opt/tracer | xargs chown netuser
WORKDIR /opt/tracer
