.PHONY: exp01 exp01-shed stop install

install:
	npm install
	cd app && npm install

exp01: install
	docker compose --profile base up -d --build
	sleep 3
	CSV_OUT=experiments/01-eventloop/results.csv node loadgen/ramp.js exp01
	node analyze/plot.js experiments/01-eventloop/results.csv > experiments/01-eventloop/summary.md
	docker compose --profile base down

exp01-shed: install
	SHED_THRESHOLD_MS=70 docker compose --profile base up -d --build
	sleep 3
	CSV_OUT=experiments/01-eventloop/results-shed.csv node loadgen/ramp.js exp01
	node analyze/plot.js experiments/01-eventloop/results-shed.csv > experiments/01-eventloop/summary-shed.md
	docker compose --profile base down

stop:
	docker compose --profile base down
	docker compose --profile shedding down
