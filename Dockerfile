FROM golang:1.22-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o phantom-paste .

FROM alpine:3.19

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /build/phantom-paste .
COPY static/ ./static/

RUN mkdir -p /app/data

EXPOSE 3693

CMD ["./phantom-paste"]
