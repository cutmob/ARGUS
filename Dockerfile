# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o argus-server ./cmd/server

# Runtime stage
FROM alpine:3.19

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY --from=builder /app/argus-server .
COPY --from=builder /app/modules ./modules
COPY --from=builder /app/configs ./configs

EXPOSE 8080

ENV PORT=8080
ENV ARGUS_MODULES_DIR=/app/modules

ENTRYPOINT ["./argus-server"]
