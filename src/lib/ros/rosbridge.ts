type RosMessage = Record<string, unknown>;

type SubscriptionCallback<T = RosMessage> = (message: T) => void;

interface Subscription {
  topic: string;
  callback: SubscriptionCallback;
}

interface PendingServiceCall {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface RosBridgeResponse {
  op?: string;
  id?: string;
  service?: string;
  values?: unknown;
  result?: boolean;
  [key: string]: unknown;
}

type StatusListener = (connected: boolean) => void;

class ROSBridge {
  private socket: WebSocket | null = null;

  private url: string | null = null;

  private connected = false;

  private connecting = false;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private requestCounter = 0;

  private subscriptions = new Map<string, Subscription>();

  private pendingServices = new Map<string, PendingServiceCall>();

  private statusListeners = new Set<StatusListener>();

  async connect(url: string): Promise<void> {
    if (this.connected && this.socket) {
      return;
    }

    if (this.connecting) {
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();

          reject(
            new Error("Timed out waiting for ROSBridge connection"),
          );
        }, 10000);

        const handleStatus = (isConnected: boolean) => {
          if (isConnected) {
            cleanup();
            resolve();
          }
        };

        const cleanup = () => {
          clearTimeout(timeout);
          this.statusListeners.delete(handleStatus);
        };

        this.statusListeners.add(handleStatus);
      });
    }

    this.url = url;
    this.connecting = true;

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const socket = new WebSocket(url);

      this.socket = socket;

      const connectionTimeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        this.connecting = false;

        socket.close();

        reject(
          new Error(`ROSBridge connection timeout: ${url}`),
        );
      }, 10000);

      socket.onopen = () => {
        if (settled) {
          return;
        }

        settled = true;

        clearTimeout(connectionTimeout);

        this.connected = true;
        this.connecting = false;

        this.notifyStatus(true);

        resolve();
      };

      socket.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      socket.onerror = () => {
        if (!settled) {
          settled = true;

          clearTimeout(connectionTimeout);

          this.connected = false;
          this.connecting = false;

          this.notifyStatus(false);

          reject(
            new Error(
              `Unable to connect to ROSBridge at ${url}`,
            ),
          );

          return;
        }

        this.connected = false;
        this.notifyStatus(false);
      };

      socket.onclose = () => {
        clearTimeout(connectionTimeout);

        this.connected = false;
        this.connecting = false;

        if (this.socket === socket) {
          this.socket = null;
        }

        this.rejectPendingServices(
          new Error("ROSBridge connection closed"),
        );

        this.notifyStatus(false);
      };
    });
  }

  subscribe<T = RosMessage>(
    topic: string,
    messageType: string,
    callback: SubscriptionCallback<T>,
  ): () => void {
    if (!this.connected || !this.socket) {
      throw new Error(
        "Cannot subscribe: ROSBridge is not connected",
      );
    }

    const subscriptionKey = `${topic}:${messageType}`;

    const existing = this.subscriptions.get(subscriptionKey);

    if (existing) {
      this.subscriptions.set(subscriptionKey, {
        ...existing,
        callback: callback as SubscriptionCallback,
      });

      return () => {
        this.unsubscribe(subscriptionKey);
      };
    }

    this.send({
      op: "subscribe",
      topic,
      type: messageType,
    });

    this.subscriptions.set(subscriptionKey, {
      topic,
      callback: callback as SubscriptionCallback,
    });

    return () => {
      this.unsubscribe(subscriptionKey);
    };
  }

  private unsubscribe(subscriptionKey: string): void {
    const subscription = this.subscriptions.get(subscriptionKey);

    if (!subscription) {
      return;
    }

    this.send({
      op: "unsubscribe",
      topic: subscription.topic,
    });

    this.subscriptions.delete(subscriptionKey);
  }

  publish(
    topic: string,
    message: RosMessage,
    messageType?: string,
  ): void {
    if (!this.connected || !this.socket) {
      throw new Error(
        "Cannot publish: ROSBridge is not connected",
      );
    }

    this.send({
      op: "publish",
      topic,
      ...(messageType ? { type: messageType } : {}),
      msg: message,
    });
  }

  callService(
    service: string,
    args: RosMessage = {},
    serviceType?: string,
  ): Promise<unknown> {
    if (!this.connected || !this.socket) {
      return Promise.reject(
        new Error(
          "Cannot call service: ROSBridge is not connected",
        ),
      );
    }

    const id = this.createRequestId();

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingServices.delete(id);

        reject(
          new Error(
            `ROS service call timed out: ${service}`,
          ),
        );
      }, 10000);

      this.pendingServices.set(id, {
        resolve,
        reject,
        timeout,
      });

      try {
        this.send({
          op: "call_service",
          service,
          ...(serviceType ? { type: serviceType } : {}),
          args,
          id,
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingServices.delete(id);
        reject(error);
      }
    });
  }

  async getParam(name: string): Promise<unknown> {
    const response = await this.callService(
      "/rosapi/get_param",
      {
        name,
        default_value: "",
      },
      "rosapi/GetParam",
    );

    const typedResponse = response as RosBridgeResponse;

    if (
      typedResponse.values &&
      typeof typedResponse.values === "object"
    ) {
      const values = typedResponse.values as Record<
        string,
        unknown
      >;

      return values["value"];
    }

    return response;
  }

  async setParam(
    name: string,
    value: unknown,
  ): Promise<unknown> {
    return this.callService(
      "/rosapi/set_param",
      {
        name,
        value: String(value),
      },
      "rosapi/SetParam",
    );
  }

  onStatusChange(
    listener: StatusListener,
  ): () => void {
    this.statusListeners.add(listener);

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  isConnected(): boolean {
    return (
      this.connected &&
      this.socket?.readyState === WebSocket.OPEN
    );
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.rejectPendingServices(
      new Error("ROSBridge disconnected"),
    );

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.connected = false;
    this.connecting = false;

    this.notifyStatus(false);
  }

  getUrl(): string | null {
    return this.url;
  }

  private send(
    payload: Record<string, unknown>,
  ): void {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      throw new Error(
        "ROSBridge WebSocket is not open",
      );
    }

    this.socket.send(JSON.stringify(payload));
  }

  private handleMessage(rawMessage: unknown): void {
    let message: RosBridgeResponse;

    try {
      message =
        typeof rawMessage === "string"
          ? (JSON.parse(rawMessage) as RosBridgeResponse)
          : (rawMessage as RosBridgeResponse);
    } catch {
      return;
    }

    if (!message || typeof message !== "object") {
      return;
    }

    if (message["op"] === "publish") {
      this.handlePublish(message);
      return;
    }

    if (
      message["op"] === "service_response" &&
      typeof message["id"] === "string"
    ) {
      this.handleServiceResponse(message);
    }
  }

  private handlePublish(
    message: RosBridgeResponse,
  ): void {
    const topic = message["topic"];

    if (typeof topic !== "string") {
      return;
    }

    for (const subscription of this.subscriptions.values()) {
      if (subscription.topic !== topic) {
        continue;
      }

      try {
        const messageData = message["msg"];

        if (
          !messageData ||
          typeof messageData !== "object"
        ) {
          continue;
        }

        subscription.callback(
          messageData as RosMessage,
        );
      } catch (error) {
        console.error(
          `ROSBridge subscriber error for ${topic}:`,
          error,
        );
      }
    }
  }

  private handleServiceResponse(
    message: RosBridgeResponse,
  ): void {
    const id = message["id"];

    if (typeof id !== "string") {
      return;
    }

    const pending = this.pendingServices.get(id);

    if (!pending) {
      return;
    }

    this.pendingServices.delete(id);

    clearTimeout(pending.timeout);

    if (message["result"] === false) {
      const values = message["values"];

      pending.reject(
        new Error(
          `ROS service rejected: ${
            typeof values === "string"
              ? values
              : "request was not accepted"
          }`,
        ),
      );

      return;
    }

    pending.resolve(
      message["values"] !== undefined
        ? message["values"]
        : message,
    );
  }

  private rejectPendingServices(
    error: Error,
  ): void {
    for (const pending of this.pendingServices.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }

    this.pendingServices.clear();
  }

  private createRequestId(): string {
    this.requestCounter += 1;

    return `drone-os-${Date.now()}-${this.requestCounter}`;
  }

  private notifyStatus(
    connected: boolean,
  ): void {
    for (const listener of this.statusListeners) {
      try {
        listener(connected);
      } catch (error) {
        console.error(
          "ROSBridge status listener error:",
          error,
        );
      }
    }
  }
}

const rosbridge = new ROSBridge();

export default rosbridge;