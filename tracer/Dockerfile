FROM ubuntu:14.04

# 14.04 is EOL but archive.ubuntu.com still serves trusty (old-releases
# dropped it — amd64 indexes 404 there as of 2026), so use the default
# sources unchanged. arm64 pulls from ports.ubuntu.com, also still live.
RUN apt-get update && apt-get install -y \
    build-essential autotools-dev automake libc6-dbg python patch \
 && rm -rf /var/lib/apt/lists/*

# Valgrind sources first: they change rarely and the compile below is the
# slow layer. The Python driver scripts are copied AFTER the compile so that
# editing them rebuilds in seconds instead of recompiling Valgrind.
COPY opt-cpp-backend/valgrind-3.11.0 /opt/tracer/valgrind-3.11.0
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
# Fix 4: expand C++ STL containers (std::vector, std::string, ...). Stock
#        Valgrind's DWARF reader ignores DW_TAG_inheritance, and its struct
#        walker only accepts constant member offsets. Class types whose data
#        lives in base classes (std::vector -> _Vector_base -> _Vector_impl)
#        therefore rendered as empty structs. This patch (a) reads base-class
#        subobjects as anonymous members and (b) decodes the DW_OP_plus_uconst
#        member-offset expression that gcc emits under -gdwarf-2. Once the
#        members are visible, Valgrind's existing pointer-follows-heap logic
#        emits the element buffer automatically.
COPY cpp-stl-dwarf-inheritance.patch /tmp/cpp-stl-dwarf-inheritance.patch
RUN cd /opt/tracer && patch -p1 < /tmp/cpp-stl-dwarf-inheritance.patch
# Fix 5: recover std::list<T> node payload values. Stock (and Fix-4-patched)
#        Valgrind decodes a list node via its type-erased _List_node_base
#        (just _M_next/_M_prev) because that's the pointer's static DWARF
#        type; the actual per-node value lives in the derived _List_node<T>,
#        which is only reachable by resolving T's node type BY NAME from the
#        enclosing list<T> container.
COPY cpp-stl-node-payload.patch /tmp/cpp-stl-node-payload.patch
RUN cd /opt/tracer && patch -p1 < /tmp/cpp-stl-node-payload.patch
WORKDIR /opt/tracer/valgrind-3.11.0
RUN ./autogen.sh && ./configure --prefix=`pwd`/inst && make && make install

# Python driver scripts — the fast-changing layer.
COPY opt-cpp-backend/run_cpp_backend.py \
     opt-cpp-backend/vg_to_opt_trace.py \
     opt-cpp-backend/step_limits.py \
     /opt/tracer/
# Fix 1: force DWARF v2 so the patched Valgrind can parse debug info
RUN sed -i "s/'-ggdb', '-O0'/'-ggdb', '-gdwarf-2', '-O0'/" /opt/tracer/run_cpp_backend.py

RUN useradd netuser && find /opt/tracer | xargs chown netuser
WORKDIR /opt/tracer
