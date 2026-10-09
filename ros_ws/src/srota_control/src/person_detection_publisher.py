#!/usr/bin/env python3

import os
import socket
import cv2
import gi
import numpy as np
import threading
import time
import torch
from ultralytics import YOLO
from flask import Flask, Response
from flask_cors import CORS

# ROS Imports
import rospy
import rospkg
from sensor_msgs.msg import CompressedImage

gi.require_version("Gst", "1.0")
gi.require_version("GstApp", "1.0")
from gi.repository import GLib, Gst, GstApp

# Initialize GStreamer
Gst.init(None)

# ---------------------------------------------------------
# Helper Function to Get Machine's Local IP
# ---------------------------------------------------------
def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# ---------------------------------------------------------
# Configuration & RTSP Input
# ---------------------------------------------------------
INPUT_RTSP_URL = "rtsp://192.168.144.25:8554/main.264"
HTTP_PORT = 8080

WIDTH = 960
HEIGHT = 540

INPUT_PIPELINE_STR = (
    f"rtspsrc location={INPUT_RTSP_URL} latency=50 protocols=tcp ! "
    "rtph265depay ! h265parse ! avdec_h265 ! "
    "videoconvert ! jpegenc quality=85 ! jpegdec ! "
    "videoconvert ! video/x-raw, format=BGR ! "
    "appsink name=sink emit-signals=True max-buffers=1 drop=True"
)

# Shared frame buffer for HTTP streaming
latest_jpeg_frame = None
frame_lock = threading.Lock()

# ---------------------------------------------------------
# Flask App Setup
# ---------------------------------------------------------
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

def generate_mjpeg_stream():
    global latest_jpeg_frame
    while not rospy.is_shutdown():
        with frame_lock:
            jpeg_bytes = latest_jpeg_frame

        if jpeg_bytes is None:
            time.sleep(0.01)
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n"
            b"Content-Length: " + str(len(jpeg_bytes)).encode() + b"\r\n\r\n"
            + jpeg_bytes + b"\r\n"
        )
        time.sleep(0.03)  # ~30 FPS throttle

@app.route("/")
@app.route("/video")
def video_feed():
    """MJPEG Streaming route mapped to both '/' and '/video'."""
    response = Response(
        generate_mjpeg_stream(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

def start_flask_server(host, port):
    import logging
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    
    server_thread = threading.Thread(
        target=lambda: app.run(host=host, port=port, threaded=True, use_reloader=False),
        daemon=True
    )
    server_thread.start()

# ---------------------------------------------------------
# Modern & Aesthetic Drawing Functions
# ---------------------------------------------------------
def draw_modern_box(
    img, x1, y1, x2, y2, color=(180, 255, 50), thickness=2, corner_length=15, overlay_alpha=0.15
):
    overlay = img.copy()
    cv2.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
    cv2.addWeighted(overlay, overlay_alpha, img, 1 - overlay_alpha, 0, img)

    cv2.rectangle(img, (x1, y1), (x2, y2), color, 1, lineType=cv2.LINE_AA)
    c_len = min(corner_length, abs(x2 - x1) // 2, abs(y2 - y1) // 2)

    cv2.line(img, (x1, y1), (x1 + c_len, y1), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x1, y1), (x1, y1 + c_len), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x2, y1), (x2 - c_len, y1), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x2, y1), (x2, y1 + c_len), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x1, y2), (x1 + c_len, y2), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x1, y2), (x1, y2 - c_len), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x2, y2), (x2 - c_len, y2), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x2, y2), (x2, y2 - c_len), color, thickness, cv2.LINE_AA)

def draw_pill_label(img, text, x, y, bg_color=(180, 255, 50), text_color=(15, 15, 15)):
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.45
    thickness = 1

    (text_w, text_h), _ = cv2.getTextSize(text, font, font_scale, thickness)

    pad_x, pad_y = 8, 6
    box_x1 = x
    box_y1 = max(0, y - text_h - (pad_y * 2))
    box_x2 = x + text_w + (pad_x * 2)
    box_y2 = y

    cv2.rectangle(img, (box_x1, box_y1), (box_x2, box_y2), bg_color, -1, lineType=cv2.LINE_AA)
    cv2.putText(img, text, (x + pad_x, box_y2 - pad_y), font, font_scale, text_color, thickness, cv2.LINE_AA)

# ---------------------------------------------------------
# Load Model & ROS Init
# ---------------------------------------------------------
rospy.init_node("person_detection_sar_node", anonymous=True)

# Use rospkg to dynamically find model path inside package models/ folder
try:
    rospack = rospkg.RosPack()
    # Replace 'YOUR_ROS_PACKAGE_NAME' with your actual ROS package name
    package_path = rospack.get_path("srota_control")
    model_path = os.path.join(package_path, "src", "bestperson_85.pt")
except Exception as e:
    rospy.logwarn(f"Failed to find model via rospkg: {e}. Falling back to default path.")
    model_path = "/home/potential/ultralytics/bestperson_85.pt"

rospy.loginfo(f"Loading YOLO model from: {model_path}")

DEVICE = 0 if torch.cuda.is_available() else "cpu"
HALF = torch.cuda.is_available()

model = YOLO(model_path)

if HALF:
    model.to(DEVICE).half()
else:
    model.to(DEVICE)

predict_lock = threading.Lock()

def thread_safe_predict(frame):
    with predict_lock:
        result = model.predict(
            source=frame,
            device=DEVICE,
            imgsz=512,
            conf=0.45,
            classes=[0],
            save=False,
            show=False,
            verbose=False,
        )[0]
    return result

# ---------------------------------------------------------
# ROS Node Setup & Publisher
# ---------------------------------------------------------
compressed_pub = rospy.Publisher(
    "/drone/camera/image_annotated/compressed", CompressedImage, queue_size=1
)

LOCAL_IP = get_local_ip()
start_flask_server("0.0.0.0", HTTP_PORT)

rospy.loginfo(f"HTTP Output Stream published at: http://{LOCAL_IP}:{HTTP_PORT}/")
rospy.loginfo("ROS Compressed Image Topic published at: /drone/camera/image_annotated/compressed")

# Input GStreamer Pipeline
pipeline = Gst.parse_launch(INPUT_PIPELINE_STR)
appsink = pipeline.get_by_name("sink")
pipeline.set_state(Gst.State.PLAYING)

def read_gstreamer_frame():
    sample = appsink.emit("pull-sample")
    if not sample:
        return None
    buffer = sample.get_buffer()
    caps = sample.get_caps()

    height = caps.get_structure(0).get_value("height")
    width = caps.get_structure(0).get_value("width")

    success, map_info = buffer.map(Gst.MapFlags.READ)
    if not success:
        return None

    frame = np.ndarray(
        shape=(height, width, 3), dtype=np.uint8, buffer=map_info.data
    ).copy()

    buffer.unmap(map_info)
    return frame

# ---------------------------------------------------------
# Main Processing Loop
# ---------------------------------------------------------
BOX_COLOR = (255, 215, 0)

try:
    while not rospy.is_shutdown():
        frame = read_gstreamer_frame()
        if frame is None:
            continue

        frame = cv2.resize(frame, (WIDTH, HEIGHT))
        result = thread_safe_predict(frame)

        for box in result.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].cpu().numpy())
            confidence = float(box.conf[0])
            class_id = int(box.cls[0])

            original_name = model.names[class_id]
            display_name = (
                "person" if original_name.lower() == "human" else original_name
            )
            label = f"{display_name.upper()}  {confidence:.0%}"

            label_y = y1 - 4 if y1 - 25 > 0 else y1 + 25

            draw_modern_box(
                frame, x1, y1, x2, y2, color=BOX_COLOR, thickness=2, corner_length=12
            )

            draw_pill_label(
                frame, label, x1, label_y, bg_color=BOX_COLOR, text_color=(10, 10, 10)
            )

        # Encode frame to JPEG
        _, jpeg_buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        jpeg_bytes = jpeg_buf.tobytes()

        # Update Shared HTTP Frame
        with frame_lock:
            latest_jpeg_frame = jpeg_bytes

        # Publish to ROS Topic as sensor_msgs/CompressedImage
        msg = CompressedImage()
        msg.header.stamp = rospy.Time.now()
        msg.header.frame_id = "drone_camera"
        msg.format = "jpeg"
        msg.data = jpeg_bytes

        compressed_pub.publish(msg)

        # Local OpenCV Window preview
        try:
            # cv2.imshow("SEARCH AND RESCUE - AI DETECTION", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
        except cv2.error:
            pass  # Handle headless execution

finally:
    pipeline.set_state(Gst.State.NULL)
    cv2.destroyAllWindows()
