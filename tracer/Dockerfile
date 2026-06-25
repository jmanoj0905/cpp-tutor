FROM ubuntu:14.04

# 14.04 is EOL — repoint apt at the archive so apt-get update works.
RUN sed -i 's|http://archive.ubuntu.com|http://old-releases.ubuntu.com|g; s|http://security.ubuntu.com|http://old-releases.ubuntu.com|g' /etc/apt/sources.list \
 && apt-get update && apt-get install -y \
    build-essential autotools-dev automake libc6-dbg python \
 && rm -rf /var/lib/apt/lists/*

COPY opt-cpp-backend /opt/tracer
# Fix 1: force DWARF v2 so the patched Valgrind can parse debug info
RUN sed -i "s/'-ggdb', '-O0'/'-ggdb', '-gdwarf-2', '-O0'/" /opt/tracer/run_cpp_backend.py
# Fix 2: add ARM64 frame-pointer (x29) register mapping so DW_OP_breg29 resolves
#        correctly when evaluating DW_OP_fbreg local-variable locations.
#        Stock Valgrind 3.11 only mapped r31(SP); r29(FP) was missing → fbGX
#        evaluation failed → empty locals at every trace step.
RUN perl -i -0pe \
    's|(#  elif defined\(VGP_arm64_linux\)\n)(   if \(regno == 31\))|${1}   if (regno == 29) { *a = regs->fp; return True; }  \/\/ x29=FP (pgbovine ARM64 fix)\n${2}|' \
    /opt/tracer/valgrind-3.11.0/coregrind/m_debuginfo/d3basics.c
# Fix 3: on AArch64 there is no dup2 syscall (__NR_dup2=1041 returns ENOSYS);
#         the real syscall is dup3 (__NR_dup3=24). Redirect VG_(dup2) to dup3
#         with flags=0 (identical semantics) so guest fd 1 is actually redirected
#         to /tmp/stdout.txt and per-step stdout is captured into the OPT trace.
RUN perl -i -pe 's{\Qreturn VG_(do_syscall2)(__NR_dup2, oldfd, newfd);\E}{#if defined(VGP_arm64_linux)\n   return VG_(do_syscall3)(__NR_dup3, oldfd, newfd, 0);\n#else\n   return VG_(do_syscall2)(__NR_dup2, oldfd, newfd);\n#endif}' \
    /opt/tracer/valgrind-3.11.0/coregrind/m_libcfile.c
WORKDIR /opt/tracer/valgrind-3.11.0
RUN ./autogen.sh && ./configure --prefix=`pwd`/inst && make && make install

RUN useradd netuser && find /opt/tracer | xargs chown netuser
WORKDIR /opt/tracer
