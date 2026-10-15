import { ConfigService } from "@nestjs/config";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { AuthService } from "./auth.service";
import { OauthDto } from "./dto/oauth.dto";

jest.mock("firebase-admin/app", () => ({
  cert: jest.fn(),
  getApps: jest.fn(),
  initializeApp: jest.fn(),
}));
jest.mock("firebase-admin/auth", () => ({ getAuth: jest.fn() }));

const PEM_BODY = "-----BEGIN PRIVATE KEY-----\\nMIIEabc\\n-----END PRIVATE KEY-----\\n";
const PEM = "-----BEGIN PRIVATE KEY-----\nMIIEabc\n-----END PRIVATE KEY-----";

const buildService = (privateKey: string) => {
  const env: Record<string, string> = {
    FIREBASE_PROJECT_ID: "demo-project",
    FIREBASE_CLIENT_EMAIL: "sdk@demo-project.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: privateKey,
  };
  const config = { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService;
  const unused = {} as never;
  return new AuthService(
    config, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused,
  );
};

const googleLogin = (service: AuthService) =>
  service.oauthGoogle({ idToken: "firebase-id-token" } as OauthDto);

describe("AuthService Firebase credentials", () => {
  const verifyIdToken = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    (getApps as jest.Mock).mockReturnValue([]);
    (initializeApp as jest.Mock).mockReturnValue({});
    (getAuth as jest.Mock).mockReturnValue({ verifyIdToken });
    verifyIdToken.mockRejectedValue(Object.assign(new Error("expired"), { code: "auth/id-token-expired" }));
  });

  it.each([
    ["unquoted (dotenv / compose)", PEM_BODY],
    ["double-quoted (docker run --env-file)", `"${PEM_BODY}"`],
    ["single-quoted", `'${PEM_BODY}'`],
  ])("passes a clean PEM to cert() when the key is %s", async (_label, raw) => {
    await expect(googleLogin(buildService(raw))).rejects.toThrow();

    expect(cert).toHaveBeenCalledWith(expect.objectContaining({ privateKey: PEM }));
  });

  it("reports a broken credential as a configuration error, not a bad token", async () => {
    (cert as jest.Mock).mockImplementation(() => {
      throw new Error("Failed to parse private key: DECODER routines::unsupported");
    });

    await expect(googleLogin(buildService(PEM_BODY))).rejects.toMatchObject({
      response: { errorKey: "auth.errors.firebaseOauthNotConfigured" },
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("still rejects a token Firebase refuses as invalidProviderIdToken", async () => {
    await expect(googleLogin(buildService(PEM_BODY))).rejects.toMatchObject({
      status: 401,
      response: { errorKey: "auth.errors.invalidProviderIdToken" },
    });
  });
});
