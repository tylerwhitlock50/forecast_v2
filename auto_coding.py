import argparse, subprocess, time, os, sys

def run_codex_cli(prompt:str, timeout:int=600):
    """Run codex cli with a prompt"""
    try:
        proc = subprocess.run(
            ["codex", '-s','danger-full-access','exec', prompt],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout
        )
        return proc.returncode, proc.stdout
    except subprocess.TimeoutExpired:
        return 124, "Codex CLI timed out"
        

def main():
    parser = argparse.ArgumentParser(description="Run codex cli with a prompt")
    parser.add_argument("--prompt", type=str, required=True, help="The prompt to run")
    parser.add_argument("--runs", type=int, default=1, help="The number of runs to do")
    parser.add_argument("--timeout", type=int, default=600, help="Timeout for codex cli (seconds)")
    args = parser.parse_args()
    
    #log the start time
    print(f"Start time: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    start_time = time.time()
          
    print(f"Running {args.runs} times with timeout {args.timeout} seconds")
    for i in range(args.runs):
        elapsed_time = time.time() - start_time
        print(f"Elapsed time: {elapsed_time:.2f} seconds")
        print(f"\n=== Run {i+1}/{args.runs} ===")
        code, output = run_codex_cli(args.prompt, args.timeout)
        print(output)
        if code != 0:
            print(f"[Codex exited with code {code}]", file=sys.stderr)

if __name__ == "__main__":
    main()