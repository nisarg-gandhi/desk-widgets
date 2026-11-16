#!/usr/bin/env python3
"""Write a habits.json with some history into the test data folder."""
import datetime, json, os, random
random.seed(7)
today = datetime.date.today()
def days(p, streak):
    out = {(today - datetime.timedelta(d)).isoformat() for d in range(1, 330) if random.random() < p}
    out |= {(today - datetime.timedelta(d)).isoformat() for d in range(1, streak + 1)}
    return sorted(out)
data = {"Read": days(0.7, 4), "Workout": days(0.35, 0), "Code": days(0.85, 12), "Meditate": days(0.15, 0), "Walk": []}
path = os.path.join(os.environ["XDG_DATA_HOME"], "desk-widgets")
os.makedirs(path, exist_ok=True)
json.dump(data, open(os.path.join(path, "habits.json"), "w"), indent=2)
