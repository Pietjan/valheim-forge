ARG ALPINE_TAG=3.22

FROM alpine:${ALPINE_TAG} AS builder
RUN apk add --no-cache ca-certificates \
 && mkdir -p /out/etc /out/bin /out/home/app \
 && echo 'nobody:x:65534:65534:nobody:/home/app:/sbin/nologin' > /out/etc/passwd \
 && echo 'nobody:x:65534:' > /out/etc/group \
 && cp /etc/ssl/certs/ca-certificates.crt /out/etc/ca-certificates.crt \
 && chown 65534:65534 /out/home/app
COPY bin/valheim-forge /out/bin/app

FROM scratch
COPY --from=builder /out/etc/passwd /etc/passwd
COPY --from=builder /out/etc/group /etc/group
COPY --from=builder /out/etc/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=builder /out/home/app /home/app
COPY --from=builder /out/bin/app /bin/app
USER nobody:nobody
WORKDIR /home/app
EXPOSE 2480
ENTRYPOINT ["/bin/app"]
