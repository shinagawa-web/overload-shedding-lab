package main

import (
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"sync/atomic"
	"time"
)

var goroutinesPeak atomic.Int64

func burnCPU(ms int) {
	deadline := time.Now().Add(time.Duration(ms) * time.Millisecond)
	x := 1.0
	for time.Now().Before(deadline) {
		x = x*1.0000001 + 0.0000001
	}
	_ = x
}

func trackGoroutines() {
	for {
		n := int64(runtime.NumGoroutine())
		for {
			cur := goroutinesPeak.Load()
			if n <= cur || goroutinesPeak.CompareAndSwap(cur, n) {
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func syncMs(r *http.Request, defaultMs int) int {
	if s := r.URL.Query().Get("ms"); s != "" {
		if v, err := strconv.Atoi(s); err == nil {
			return v
		}
	}
	return defaultMs
}

func lightHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprint(w, `{"ok":true}`)
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	fmt.Fprintf(w, "go_goroutines_peak %d\ngo_mem_mb %.1f\n",
		goroutinesPeak.Load(),
		float64(m.Sys)/1024/1024,
	)
}

func main() {
	arm := os.Getenv("ARM")
	workerCap, _ := strconv.Atoi(os.Getenv("WORKER_CAP"))
	if workerCap <= 0 {
		workerCap = 10
	}
	defaultMs, _ := strconv.Atoi(os.Getenv("SYNC_MS"))

	go trackGoroutines()

	mux := http.NewServeMux()
	mux.HandleFunc("/light", lightHandler)
	mux.HandleFunc("/metrics", metricsHandler)

	switch arm {
	case "b":
		sem := make(chan struct{}, workerCap)
		mux.HandleFunc("/sync-cpu", func(w http.ResponseWriter, r *http.Request) {
			sem <- struct{}{}
			defer func() { <-sem }()
			burnCPU(syncMs(r, defaultMs))
			fmt.Fprint(w, `{"ok":true}`)
		})
	case "c":
		sem := make(chan struct{}, workerCap)
		mux.HandleFunc("/sync-cpu", func(w http.ResponseWriter, r *http.Request) {
			select {
			case sem <- struct{}{}:
			default:
				w.WriteHeader(http.StatusServiceUnavailable)
				fmt.Fprint(w, `{"error":"overloaded"}`)
				return
			}
			defer func() { <-sem }()
			burnCPU(syncMs(r, defaultMs))
			fmt.Fprint(w, `{"ok":true}`)
		})
	default:
		mux.HandleFunc("/sync-cpu", func(w http.ResponseWriter, r *http.Request) {
			burnCPU(syncMs(r, defaultMs))
			fmt.Fprint(w, `{"ok":true}`)
		})
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
